import type { InputFrame, LevelSpec, RunResult, EnemyKind } from './types';
import type { Bullet, Enemy, Particle, PlayerState } from './entities';
import { spawnEnemy, nextId } from './entities';
import { RNG, mixSeed, hashString } from './rng';
import { generateLevel } from './levelgen';
import { Renderer } from './render';
import { InputController } from './input';
import { modsFor, skrRewardForLevel } from './difficulty';
import { getShip, getWeapon, SHIPS, WEAPONS } from './ships';
import { spawnBoss, updateBoss, type Boss } from './boss';
import { BOSS_SPECS } from './enemies';
import { audio } from './audio';
import { attachTouchControls } from './touchControls';
import { rollDrop, bossDrop, pickAnyPowerup, spawnPowerup, POWERUP_SPECS, type Powerup, type PowerupKind } from './powerups';

const W = 480;
const H = 960;
const FIXED_DT = 1 / 60;
/// Height of the reserved touch-controls band at the bottom of the canvas.
/// The player can never enter this band; enemies despawn before crossing it.
const CONTROL_BAND_H = 220;
const PLAYABLE_BOTTOM = H - CONTROL_BAND_H;     // 740

export interface GameEvents {
  onLevelComplete: (result: RunResult) => void;
  onGameOver: (result: RunResult) => void;
  onScoreChange: (score: number) => void;
  onPowerupPicked?: (kind: string) => void;
}

export class Game {
  renderer: Renderer;
  input: InputController;
  level!: LevelSpec;
  rng!: RNG;

  player!: PlayerState;
  bullets: Bullet[] = [];
  enemies: Enemy[] = [];
  particles: Particle[] = [];
  powerups: Powerup[] = [];
  boss: Boss | null = null;
  // Bomb visual flight. `targetX/Y` is sampled once at fire-time so the
  // bullet doesn't curve mid-flight. Detonation hits all enemies regardless
  // of where the burst happens — this is pure eye-candy.
  bombAnim: { x: number; y: number; targetX: number; targetY: number; t: number } | null = null;
  carriedScore = 0;       // points accumulated across levels in this session
  carriedKills = 0;       // enemy kills accumulated across levels (matches carriedScore)
  carriedBombs = 2;       // bombs persist across levels
  carriedLives: number | null = null;
  carriedArmor = 0;
  carriedExtraShots = 0;
  carriedRapidFire = false;
  carriedWeaponMode: 'normal' | 'laser' | 'plasma' | 'rocket' | 'homing-rocket' = 'normal';
  carriedWingmen = 0;

  waveIndex = 0;
  waveTimer = 0;
  pendingSpawns: Array<{ at: number; e: Enemy }> = [];
  frame = 0;
  elapsedMs = 0;
  lootDroppedThisLevel = 0;
  lootCapThisLevel = 1;
  /**
   * Sliding window of the last two powerup kinds dropped in the current
   * run. Used to enforce "max 2 in a row" — if both entries match the
   * next rolled drop, we replace it with a different kind. Reset on
   * player death (new run); preserved across level transitions inside
   * a single run so the rule spans the whole run.
   */
  recentDrops: PowerupKind[] = [];
  /**
   * Loot RNG is deliberately NON-deterministic — uses Math.random() so
   * each restart yields a fresh loot scenario. The deterministic
   * `this.rng` (seeded from player+level+day) still drives enemy AI,
   * bullet jitter, and the backend's score-replay verifier; only loot
   * is randomised per-run.
   */
  private lootRng: () => number = Math.random;
  bossSpawned = false;     // becomes true the moment spawnBoss() runs this level
  state: 'running' | 'paused' | 'won' | 'lost' | 'idle' = 'idle';
  bossPhaseAnnounce = 0;
  events: GameEvents;
  playerAddr = '0x0000000000000000000000000000000000000000';
  shopWeaponId = 'single';
  shopShipId = 'scout';
  acc = 0;
  lastT = 0;

  // For replay determinism we expose:
  inputsForRun: InputFrame[] = [];

  constructor(canvas: HTMLCanvasElement, events: GameEvents) {
    this.renderer = new Renderer(canvas);
    this.input = new InputController();
    this.input.attach(canvas);
    attachTouchControls(canvas, this.input);
    this.events = events;
  }

  setPlayerAddress(addr: string) { this.playerAddr = addr; }
  setShip(id: string) { this.shopShipId = id; }
  setWeapon(id: string) { this.shopWeaponId = id; }

  loadLevel(levelId: number, dailyEpoch: number = Math.floor(Date.now() / 86_400_000)) {
    this.level = generateLevel(levelId);
    const seed = mixSeed(
      hashString(this.playerAddr.toLowerCase()),
      mixSeed(this.level.seedSalt, dailyEpoch),
    );
    this.rng = new RNG(seed);
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.powerups = [];
    this.boss = null;
    this.bombAnim = null;
    this.waveIndex = 0;
    this.waveTimer = 0;
    this.pendingSpawns = [];
    this.frame = 0;
    this.elapsedMs = 0;
    // Reset the captured-inputs array per level. Without this the array
    // accumulates across levels in a multi-level run and the framesElapsed
    // vs inputs.length check trips `input_overrun` on L2+.
    this.inputsForRun = [];
    this.lootDroppedThisLevel = 0;
    // Loot caps tuned per playtest:
    //   L1-20  → 1 drop
    //   L21-40 → 2
    //   L41-80 → 3
    //   L81-100→ 4
    this.lootCapThisLevel =
      levelId <= 20 ? 1 :
      levelId <= 40 ? 2 :
      levelId <= 80 ? 3 : 4;
    this.bossSpawned = false;
    this.bossPhaseAnnounce = 0;
    this.input.reset();

    const ship = getShip(this.shopShipId);
    const weapon = getWeapon(this.shopWeaponId);
    this.player = {
      ship,
      weapons: [weapon],
      x: W / 2,
      y: PLAYABLE_BOTTOM - 40,
      hp: this.carriedLives ?? ship.hp,
      fireCooldown: 0,
      invul: 1.5,
      bombs: this.carriedBombs,
      score: this.carriedScore,
      combo: 0,
      comboTimer: 0,
      // Carry kills across levels to match `score` — backend bound is
      // cumulative and breaks if score is cumulative but kills are not.
      enemiesKilled: this.carriedKills,
      damageDealt: 0,
      damageTaken: 0,
      shielded: ship.shieldSlots > 0,
      shieldHp: ship.shieldSlots,
      armor: this.carriedArmor,
      extraShots: this.carriedExtraShots,
      rapidFire: this.carriedRapidFire,
      weaponMode: this.carriedWeaponMode,
      // Wingman seating: 1 carried → left only; 2 carried → both sides.
      wingmenSlots:
        this.carriedWingmen >= 2 ? [-28, 28] :
        this.carriedWingmen >= 1 ? [-28] : [],
    };
    // Log the level's enemy budget so it's visible & verifiable in dev tools.
    const total = this.level.waves.reduce((a, w) => a + w.enemies.length, 0);
    console.log(`[level ${levelId}] waves=${this.level.waves.length} enemies=${total} boss=${this.level.isBoss}`);

    this.state = 'running';
    audio.playMusic(this.level.music);
  }

  start() {
    this.state = 'running';
    this.lastT = performance.now();
    requestAnimationFrame(this.tick);
  }

  pause() { if (this.state === 'running') this.state = 'paused'; }
  resume() { if (this.state === 'paused') { this.state = 'running'; this.lastT = performance.now(); requestAnimationFrame(this.tick); } }

  private tick = (t: number) => {
    if (this.state === 'paused' || this.state === 'idle') return;
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      this.step(FIXED_DT);
      this.acc -= FIXED_DT;
    }
    this.draw();
    if (this.state === 'running') requestAnimationFrame(this.tick);
  };

  private step(dt: number) {
    this.frame++;
    this.elapsedMs += dt * 1000;
    const input = this.input.capture(this.frame);
    this.inputsForRun.push(input);

    this.updatePlayer(input, dt);
    this.advanceWaves(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updatePowerups(dt);
    this.updateBombAnim(dt);
    if (this.boss) {
      updateBoss(this.boss, {
        dt,
        playerX: this.player.x, playerY: this.player.y,
        spawnBullet: (b) => this.bullets.push(b),
        spawnEnemyExt: (e) => this.enemies.push(e),
        rngNext: () => this.rng.next(),
      });
    }
    this.collisions();
    this.checkEndConditions();
    this.renderer.updateStars(dt);
  }

  private updatePlayer(inp: InputFrame, dt: number) {
    const p = this.player;
    const sp = p.ship.speed;
    if (inp.left)  p.x -= sp * dt;
    if (inp.right) p.x += sp * dt;
    if (inp.up)    p.y -= sp * dt;
    if (inp.down)  p.y += sp * dt;
    p.x = Math.max(14, Math.min(W - 14, p.x));
    // -34 (was -14) keeps the whole ship sprite above the control-band
    // line — the old value let the bottom edge clip ~20 px under the band.
    p.y = Math.max(40, Math.min(PLAYABLE_BOTTOM - 34, p.y));
    p.invul = Math.max(0, p.invul - dt);
    p.comboTimer = Math.max(0, p.comboTimer - dt);
    if (p.comboTimer === 0) p.combo = 0;
    p.fireCooldown -= dt;
    if (inp.fire && p.fireCooldown <= 0) {
      this.firePlayer();
      audio.play('shoot');
      const rapidMul = p.rapidFire ? 1.55 : 1;
      // Heavy weapons fire slower than the default cannon.
      let modeMul = 1;
      if (p.weaponMode === 'rocket') modeMul = 0.7;            // -30% fire rate
      else if (p.weaponMode === 'homing-rocket') modeMul = 0.35; // homing-rocket: half of regular rocket = 50% even slower
      else if (p.weaponMode === 'plasma') modeMul = 0.85;
      else if (p.weaponMode === 'laser') modeMul = 1.15;
      p.fireCooldown = 1 / ((p.ship.fireRate + 1) * rapidMul * modeMul);
    }
    if (inp.bomb && p.bombs > 0 && !this.bombAnim) {
      this.startBombAnim();
      p.bombs -= 1;
    }
  }

  private startBombAnim() {
    audio.play('bomb');
    // Target: upper third of the playable zone (y ≈ PLAYABLE_BOTTOM / 3),
    // with ±90 px random horizontal jitter around the centre so consecutive
    // bombs don't detonate in exactly the same pixel.
    const jitter = (this.rng.next() - 0.5) * 180;
    this.bombAnim = {
      x: this.player.x,
      y: this.player.y - 10,
      targetX: W / 2 + jitter,
      targetY: PLAYABLE_BOTTOM / 3,
      t: 0,
    };
  }

  private firePlayer() {
    const p = this.player;
    const extra = Math.max(0, Math.min(2, p.extraShots));

    // Powerup-driven weapon mode overrides default weapon.
    if (p.weaponMode !== 'normal') {
      const shoot = (x: number, y: number) => {
        if (p.weaponMode === 'laser')  this.shootLaser(x, y);
        if (p.weaponMode === 'plasma') this.shootPlasma(x, y);
        if (p.weaponMode === 'rocket') this.shootRocket(x, y);
        if (p.weaponMode === 'homing-rocket') this.shootHomingRocket(x, y);
      };
      // 1 base + extra side shots.
      shoot(p.x, p.y - 14);
      if (extra >= 1) shoot(p.x - 12, p.y - 8);
      if (extra >= 2) shoot(p.x + 12, p.y - 8);
      // Wingmen mirror the same fire — one shot per live wingman.
      for (const off of p.wingmenSlots) shoot(p.x + off, p.y - 8);
      return;
    }

    // Default weapon path (from inventory).
    for (const w of p.weapons) {
      const fire = (dx: number, dy: number, vx: number, vy: number) =>
        this.bullets.push(mkPlayerBullet(p.x + dx, p.y + dy, vx, vy, w.damage, w.color));
      // Wingmen fire straight up matching weapon color.
      for (const off of p.wingmenSlots) {
        this.bullets.push(mkPlayerBullet(p.x + off, p.y - 8, 0, -500, w.damage, w.color));
      }
      switch (w.pattern) {
        case 'single':
          fire(0, -14, 0, -500);
          if (extra >= 1) fire(-8, -10, 0, -500);
          if (extra >= 2) fire(8, -10, 0, -500);
          break;
        case 'double':
          fire(-6, -10, 0, -500); fire(6, -10, 0, -500);
          if (extra >= 1) fire(-12, -6, -40, -480);
          if (extra >= 2) fire(12, -6, 40, -480);
          break;
        case 'triple':
          fire(0, -14, 0, -540); fire(-6, -8, -60, -480); fire(6, -8, 60, -480);
          break;
        case 'spread':
          for (let i = -2; i <= 2; i++) fire(0, -10, i * 60, -460);
          break;
        case 'laser': this.shootLaser(p.x, p.y - 14); break;
        case 'plasma': this.shootPlasma(p.x, p.y - 14); break;
        case 'homing':
          this.bullets.push({ ...mkPlayerBullet(p.x, p.y - 14, 0, -380, w.damage, w.color, 4), homing: true });
          break;
      }
    }
  }

  private shootLaser(x: number, y: number) {
    this.bullets.push({ ...mkPlayerBullet(x, y, 0, -820, 2, '#00d4ff', 3), visualKind: 'laser' });
  }
  private shootPlasma(x: number, y: number) {
    this.bullets.push({ ...mkPlayerBullet(x, y, 0, -440, 3, '#ff3df0', 9), visualKind: 'plasma' });
  }
  private shootRocket(x: number, y: number) {
    this.bullets.push({ ...mkPlayerBullet(x, y, 0, -380, 2, '#ff8c1a', 5), aoeRadius: 35, visualKind: 'rocket' });
  }
  private shootHomingRocket(x: number, y: number) {
    this.bullets.push({
      ...mkPlayerBullet(x, y, 0, -300, 2, '#ff0044', 5),
      aoeRadius: 35, visualKind: 'rocket', homing: true, life: 4,
    });
  }

  private detonateBomb() {
    for (const e of this.enemies) {
      e.hp -= 3;
      this.spawnExplosion(e.x, e.y, e.spec.color);
    }
    // Clear enemy bullets.
    this.bullets = this.bullets.filter((b) => b.owner !== 'enemy');
    if (this.boss) {
      this.boss.hp -= 8;
      this.boss.flash = 0.2;
    }

    // ── Fireball burst at the bomb's landing point ─────────────────
    // Use the bomb anim's final position so the visual matches where the
    // sprite is right now (was hard-coded to W/2, H/2, which is why the
    // flash always appeared in the old center spot).
    const cx = this.bombAnim?.x ?? W / 2;
    const cy = this.bombAnim?.y ?? PLAYABLE_BOTTOM / 3;
    const FLAME_COLORS = ['#fff7c2', '#ffd84d', '#ff8c1a', '#ff4860', '#ff0044'];

    // Bright shock-flash core — outward burst of small sparks.
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 600;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.25,
        maxLife: 0.7,
        color: FLAME_COLORS[i % FLAME_COLORS.length],
        size: 5,
      });
    }
    // Slow billowing flames — bigger, longer-lived, rising.
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,        // bias upward like real flame
        life: 0.9 + Math.random() * 0.5,
        maxLife: 1.4,
        color: FLAME_COLORS[Math.min(FLAME_COLORS.length - 1, 1 + (i % 3))],
        size: 8,
      });
    }
    // Smoke / soot — slower, darker, lingers.
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 100;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 50,
        y: cy + (Math.random() - 0.5) * 50,
        vx: Math.cos(a) * sp * 0.5,
        vy: Math.sin(a) * sp * 0.5 - 30,
        life: 1.2 + Math.random() * 0.6,
        maxLife: 1.8,
        color: '#3a1a0a',
        size: 10,
      });
    }
    // Tiny white seed flash — same scale as the bomb sprite (~16 px) so it
    // reads as a glint inside the fireball, not a giant white square.
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x: cx, y: cy,
        vx: 0, vy: 0,
        life: 0.10, maxLife: 0.10,
        color: '#ffffff',
        size: 8 + i * 4,                // 8, 12, 16
      });
    }
  }

  private advanceWaves(dt: number) {
    this.waveTimer += dt * 1000;
    while (this.waveIndex < this.level.waves.length &&
           this.waveTimer >= this.level.waves[this.waveIndex].delayMs) {
      const wave = this.level.waves[this.waveIndex];
      const m = modsFor(this.level.id);
      for (const e of wave.enemies) {
        const enemy = spawnEnemy(e.kind, e.x, e.y, m.hp, m.speed, m.fireRate, e.formationGroup ?? 1);
        if (e.delayMs && e.delayMs > 0) {
          this.pendingSpawns.push({ at: this.elapsedMs + e.delayMs, e: enemy });
        } else {
          this.enemies.push(enemy);
        }
      }
      this.waveIndex++;
    }
    // pending delayed spawns
    this.pendingSpawns = this.pendingSpawns.filter((s) => {
      if (this.elapsedMs >= s.at) { this.enemies.push(s.e); return false; }
      return true;
    });

    // boss spawn when waves done & still alive enemies cleared
    if (this.level.isBoss && !this.boss && !this.bossSpawned &&
        this.waveIndex >= this.level.waves.length &&
        this.enemies.length === 0) {
      const m = modsFor(this.level.id);
      // HP is taken straight from BOSS_SPECS — boss HP already encodes per-level scaling.
      this.boss = spawnBoss(this.level.boss!, this.level.id, 1);
      this.bossSpawned = true;
      console.log(`[boss] spawned ${this.level.boss} on level ${this.level.id}`);
    }
  }

  private updateEnemies(dt: number) {
    const m = modsFor(this.level.id);
    for (const e of this.enemies) {
      e.age += dt;
      // entry: descend to anchor
      if (e.state === 'enter') {
        e.y += e.spec.speed * m.speed * 0.6 * dt;
        if (e.y >= e.anchorY) {
          e.state = e.spec.behavior === 'kamikaze' ? 'kamikaze' : 'formation';
        }
      }
      // formation drift
      if (e.state === 'formation') {
        const t = e.age + (e.weaveOffset ?? 0);
        if (e.spec.behavior === 'weave') {
          e.x += Math.cos(t * 2) * 80 * dt;
          e.y = e.anchorY + Math.sin(t * 1.5) * 20;
        } else {
          e.x = e.anchorX + Math.sin(t * 0.8) * 30;
        }
        // dive attack chance
        if (e.spec.behavior === 'dive' && Math.random() < 0.0025 * (1 + this.level.id/50)) {
          e.state = 'dive';
          e.diveTarget = { x: this.player.x, y: this.player.y };
        }
        // Phantom invis trigger (~every 4s when crossing an integer second).
        if (e.kind === 'phantom' && Math.floor(e.age) % 4 === 0 && e.age - Math.floor(e.age) < 0.05) {
          e.state = 'invisible';
          e.invisStartedAt = e.age;
        }
      }
      if (e.state === 'invisible') {
        e.x = e.anchorX + Math.sin(e.age * 1.5) * 40;
        // Hard cap on invisibility — 1.5 seconds, then forced back to formation.
        const startedAt = e.invisStartedAt ?? e.age;
        if (e.age - startedAt > 1.5) {
          e.state = 'formation';
          e.invisStartedAt = undefined;
        }
      }
      if (e.state === 'dive') {
        const tgt = e.diveTarget!;
        const dx = tgt.x - e.x, dy = tgt.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = e.spec.speed * m.speed * 2;
        e.x += dx/d * sp * dt;
        e.y += dy/d * sp * dt;
        if (e.y > H || (Math.abs(dx) < 4 && Math.abs(dy) < 4)) {
          e.state = 'retreat';
        }
      }
      if (e.state === 'retreat') {
        e.y -= e.spec.speed * m.speed * 1.2 * dt;
        if (e.y < -40) { e.y = -40; e.x = e.anchorX; e.state = 'enter'; }
      }
      if (e.state === 'kamikaze') {
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.x += dx/d * e.spec.speed * m.speed * dt;
        e.y += dy/d * e.spec.speed * m.speed * dt;
        // Kamikaze flying past the bottom of the screen is despawned — without this
        // they wander forever off-screen and the level never clears.
        if (e.y > PLAYABLE_BOTTOM) e.hp = 0;     // never enter the control band
      }

      // voidling teleport
      if (e.kind === 'voidling') {
        e.teleportCooldown = (e.teleportCooldown ?? 1.5) - dt;
        if (e.teleportCooldown <= 0) {
          e.x = this.player.x + (Math.random() - 0.5) * 120;
          e.y = this.player.y - 80 - Math.random() * 80;
          e.teleportCooldown = 2 + Math.random() * 1.5;
          for (let i = 0; i < 12; i++) {
            this.particles.push({
              x: e.x, y: e.y,
              vx: (Math.random()-0.5)*120, vy: (Math.random()-0.5)*120,
              life: 0.4, maxLife: 0.4, color: '#9d4dff', size: 3,
            });
          }
        }
      }

      // firing
      if (e.spec.fireRate > 0 && e.state !== 'enter') {
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0) {
          this.enemyFire(e);
          e.fireCooldown = 1 / (e.spec.fireRate * m.fireRate);
        }
      }
    }
    // Safety net: anything wandering off-screen (bottom OR sides) for >1s is
    // despawned so the level can finish. 'enter' and 'retreat' states are
    // exempt — they legitimately sit off-screen and re-enter.
    // Cross / column patterns with high budgets could push anchorX past the
    // playable area, leaving formation enemies bobbing forever invisibly.
    for (const e of this.enemies) {
      if (e.state === 'enter' || e.state === 'retreat') continue;
      const offBottom = e.y > PLAYABLE_BOTTOM;
      const offSide   = e.x < -40 || e.x > W + 40;
      if (offBottom || offSide) e.hp = 0;
    }
  }

  private enemyFire(e: Enemy) {
    const m = modsFor(this.level.id);
    const bs = e.spec.bulletSpeed * m.bulletSpeed;
    if (e.kind === 'sniper' || e.kind === 'reaper' || e.kind === 'turret') {
      // aimed
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      this.bullets.push({
        x: e.x, y: e.y, vx: dx/d*bs, vy: dy/d*bs,
        owner: 'enemy', damage: 1, color: e.spec.color, size: 4, life: 5,
        reflectable: e.kind !== 'reaper',
      });
    } else if (e.kind === 'bomber') {
      // slow heavy
      this.bullets.push({
        x: e.x, y: e.y, vx: 0, vy: bs * 0.6,
        owner: 'enemy', damage: 1, color: '#ff8c1a', size: 6, life: 5,
      });
    } else if (e.kind === 'mirror') {
      // double straight
      this.bullets.push({ x: e.x - 6, y: e.y, vx: 0, vy: bs, owner: 'enemy', damage: 1, color: '#c0e0ff', size: 4, life: 5 });
      this.bullets.push({ x: e.x + 6, y: e.y, vx: 0, vy: bs, owner: 'enemy', damage: 1, color: '#c0e0ff', size: 4, life: 5 });
    } else {
      this.bullets.push({
        x: e.x, y: e.y + 8, vx: 0, vy: bs,
        owner: 'enemy', damage: 1, color: e.spec.color, size: 4, life: 5,
      });
    }
  }

  private updateBullets(dt: number) {
    for (const b of this.bullets) {
      if (b.homing) {
        let tx = 0, ty = 0, sp = 460;
        if (b.owner === 'player') {
          // Find nearest enemy.
          let bestD = Infinity, target: Enemy | null = null;
          for (const e of this.enemies) {
            const d = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
            if (d < bestD) { bestD = d; target = e; }
          }
          if (target) { tx = target.x; ty = target.y; }
          else if (this.boss) { tx = this.boss.x; ty = this.boss.y; }
          else continue;
        } else {
          // Enemy homing → tracks player.
          tx = this.player.x; ty = this.player.y;
          sp = 220;
        }
        const dx = tx - b.x, dy = ty - b.y;
        const L = Math.hypot(dx, dy) || 1;
        b.vx = (b.vx + (dx/L)*sp*0.25) * 0.95;
        b.vy = (b.vy + (dy/L)*sp*0.25) * 0.95;
        const total = Math.hypot(b.vx, b.vy) || 1;
        b.vx = b.vx / total * sp;
        b.vy = b.vy / total * sp;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    this.bullets = this.bullets.filter(
      (b) => b.life > 0 && b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10,
    );
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private updatePowerups(dt: number) {
    const p = this.player;
    for (const u of this.powerups) {
      u.age += dt;
      u.y += u.vy * dt;
      u.x += u.vx * dt;
      if (Math.abs(u.x - p.x) < 16 && Math.abs(u.y - p.y) < 16) {
        this.applyPowerup(u.kind);
        u.y = H + 100;     // mark for removal
      }
    }
    this.powerups = this.powerups.filter((u) => u.y < H + 20);
  }

  private applyPowerup(kind: PowerupKind) {
    const p = this.player;
    const spec = POWERUP_SPECS[kind];
    audio.play('pickup');
    switch (kind) {
      case 'life':   p.hp += 1; break;
      case 'bomb':   p.bombs += 1; break;
      case 'laser':  p.weaponMode = 'laser'; break;
      case 'plasma': p.weaponMode = 'plasma'; break;
      case 'rocket': p.weaponMode = 'rocket'; break;
      case 'double': p.extraShots = Math.min(2, p.extraShots + 1); break;
      case 'rapid':  p.rapidFire = true; break;
      case 'armor':  p.armor += 1; break;
      case 'points': p.score += 100; this.events.onScoreChange(p.score); break;
    }
    this.flashText(spec.label, spec.color);
    this.events.onPowerupPicked?.(kind);
  }

  flashTextMsg: { text: string; color: string; t: number } | null = null;
  private flashText(text: string, color: string) {
    this.flashTextMsg = { text, color, t: 0 };
  }

  private updateBombAnim(dt: number) {
    if (!this.bombAnim) return;
    this.bombAnim.t += dt;
    const dur = 0.6;
    const u = Math.min(1, this.bombAnim.t / dur);
    // Ease-out cubic toward the pre-sampled target (upper third + horizontal jitter).
    this.bombAnim.x += (this.bombAnim.targetX - this.bombAnim.x) * (1 - Math.pow(1 - u, 3));
    this.bombAnim.y += (this.bombAnim.targetY - this.bombAnim.y) * (1 - Math.pow(1 - u, 3));
    if (u >= 1) {
      this.detonateBomb();
      this.bombAnim = null;
    }
  }

  private collisions() {
    const p = this.player;

    // player bullets vs enemies / boss
    for (const b of this.bullets) {
      if (b.owner !== 'player') continue;
      // boss
      if (this.boss) {
        const bx = this.boss.x, by = this.boss.y;
        const bw = this.boss.w/2, bh = this.boss.h/2;
        if (b.x > bx - bw && b.x < bx + bw && b.y > by - bh && b.y < by + bh) {
          this.boss.hp -= b.damage;
          this.boss.flash = 0.08;
          b.life = 0;
          p.damageDealt += b.damage;
          this.spawnHit(b.x, b.y, this.boss.color);
          if (this.boss.hp <= 0) {
            this.onBossDeath();
          }
          continue;
        }
      }
      for (const e of this.enemies) {
        if (e.state === 'invisible') continue;
        const hitRadius = e.spec.size + (b.size > 6 ? b.size - 6 : 0); // plasma orbs have generous radius
        if (Math.abs(e.x - b.x) < hitRadius && Math.abs(e.y - b.y) < hitRadius) {
          e.hp -= b.damage;
          b.life = 0;
          p.damageDealt += b.damage;
          this.spawnHit(b.x, b.y, e.spec.color);
          if (e.hp <= 0) this.onEnemyDeath(e);
          // AoE rocket: damage nearby enemies + boss
          if (b.aoeRadius) {
            this.spawnExplosion(b.x, b.y, '#ff8c1a');
            for (const e2 of this.enemies) {
              if (e2 === e) continue;
              const d = Math.hypot(e2.x - b.x, e2.y - b.y);
              if (d < b.aoeRadius!) {
                e2.hp -= b.damage;
                if (e2.hp <= 0) this.onEnemyDeath(e2);
              }
            }
            if (this.boss) {
              const d = Math.hypot(this.boss.x - b.x, this.boss.y - b.y);
              if (d < b.aoeRadius!) {
                this.boss.hp -= b.damage;
                this.boss.flash = 0.1;
                if (this.boss.hp <= 0) this.onBossDeath();
              }
            }
          }
          break;
        }
      }
    }

    // enemy bullets vs player
    if (p.invul <= 0) {
      for (const b of this.bullets) {
        if (b.owner !== 'enemy') continue;
        if (Math.abs(p.x - b.x) < 8 && Math.abs(p.y - b.y) < 10) {
          b.life = 0;
          this.damagePlayer(1);
        }
      }
      // enemies touching player
      for (const e of this.enemies) {
        if (Math.abs(e.x - p.x) < e.spec.size + 6 && Math.abs(e.y - p.y) < e.spec.size + 6) {
          e.hp = 0;
          this.onEnemyDeath(e);
          this.damagePlayer(1);
          break;
        }
      }
    }

    // ── Wingman collisions (independent of player invuln) ──
    // Each live wingman is a small ship at (p.x + offset, p.y + 6). A single hit
    // from an enemy bullet or contact with an enemy destroys it.
    if (p.wingmenSlots.length > 0) {
      for (let i = p.wingmenSlots.length - 1; i >= 0; i--) {
        const off = p.wingmenSlots[i];
        const wx = p.x + off;
        const wy = p.y + 6;
        let died = false;

        // Enemy bullets
        for (const b of this.bullets) {
          if (b.owner !== 'enemy') continue;
          if (Math.abs(wx - b.x) < 10 && Math.abs(wy - b.y) < 12) {
            b.life = 0;
            died = true;
            break;
          }
        }
        // Enemy contact
        if (!died) {
          for (const e of this.enemies) {
            if (e.state === 'invisible') continue;
            if (Math.abs(e.x - wx) < e.spec.size + 6 && Math.abs(e.y - wy) < e.spec.size + 6) {
              e.hp = 0;
              this.onEnemyDeath(e);
              died = true;
              break;
            }
          }
        }
        if (died) {
          p.wingmenSlots.splice(i, 1);
          this.spawnExplosion(wx, wy, '#00d4ff');
          audio.play('damage');
        }
      }
    }

    // clean dead
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  private onEnemyDeath(e: Enemy) {
    // Linear scoring — flat reward per enemy kind, no combo / level /
    // booster multipliers. See basestriker Game.ts for rationale.
    this.player.score += e.spec.reward;
    this.player.combo += 1;        // tracked for the visual "xN" chip only
    this.player.comboTimer = 2.5;
    this.player.enemiesKilled += 1;
    this.spawnExplosion(e.x, e.y, e.spec.color);
    audio.play('explode');
    if (e.kind === 'splitter' && (e.splitterChildren ?? 0) === 0) {
      const c1 = spawnEnemy('grunt', e.x - 12, e.y, 1, 1, 1, e.formationGroup);
      const c2 = spawnEnemy('grunt', e.x + 12, e.y, 1, 1, 1, e.formationGroup);
      c1.state = 'formation'; c2.state = 'formation';
      this.enemies.push(c1, c2);
    }
    // Random loot drop — capped per level. Rockets are extra-rare:
    // a rocket can only drop on levels divisible by 10 (i.e. <=1 per 10 levels per run).
    if (this.lootDroppedThisLevel < this.lootCapThisLevel) {
      let drop = rollDrop(this.lootRng);
      // Suppress rocket drops outside the rare slot.
      if (drop === 'rocket' && this.level.id % 10 !== 0) {
        // Re-roll once skipping rocket weight; if it still wants rocket, drop nothing.
        drop = rollDrop(this.lootRng);
        if (drop === 'rocket') drop = null;
      }
      // No 3-in-a-row of the same kind — if the previous two drops match
      // the rolled kind, replace with a different one picked from the same
      // weighted distribution.
      if (drop !== null
          && this.recentDrops.length >= 2
          && this.recentDrops[0] === drop
          && this.recentDrops[1] === drop) {
        drop = pickAnyPowerup(this.lootRng, drop);
        if (drop === 'rocket' && this.level.id % 10 !== 0) {
          drop = pickAnyPowerup(this.lootRng, 'rocket');
        }
      }
      if (drop) {
        this.powerups.push(spawnPowerup(drop, e.x, e.y));
        this.lootDroppedThisLevel++;
        this.recentDrops.push(drop);
        if (this.recentDrops.length > 2) this.recentDrops.shift();
      }
    }
    this.events.onScoreChange(this.player.score);
  }

  private onBossDeath() {
    if (!this.boss) return;
    const spec = BOSS_SPECS[this.boss.kind];
    this.player.score += spec.reward;
    for (let i = 0; i < 80; i++) {
      this.particles.push({
        x: this.boss.x + (Math.random()-0.5)*60,
        y: this.boss.y + (Math.random()-0.5)*40,
        vx: (Math.random()-0.5)*300, vy: (Math.random()-0.5)*300,
        life: 1.2, maxLife: 1.2,
        color: this.boss.color, size: 5,
      });
    }
    // Boss always drops a powerful loot + a points loot. Apply the same
    // no-3-in-a-row guard so a boss kill after two same-kind drops can't
    // perpetuate the streak.
    let bk = bossDrop(this.lootRng);
    if (this.recentDrops.length >= 2
        && this.recentDrops[0] === bk
        && this.recentDrops[1] === bk) {
      bk = bossDrop(this.lootRng, bk);
    }
    this.powerups.push(spawnPowerup(bk, this.boss.x - 16, this.boss.y));
    this.powerups.push(spawnPowerup('points', this.boss.x + 16, this.boss.y));
    this.recentDrops.push(bk);
    if (this.recentDrops.length > 2) this.recentDrops.shift();
    this.boss = null;
    audio.play('boss-die');
    this.events.onScoreChange(this.player.score);
  }

  private damagePlayer(d: number) {
    const p = this.player;
    // Armor absorbs first, then shield, then HP.
    if (p.armor > 0) {
      p.armor -= 1;
      this.spawnHit(p.x, p.y, '#9ad0ff');
      p.invul = 0.7;
      audio.play('damage');
      return;
    }
    if (p.shielded && p.shieldHp > 0) {
      p.shieldHp -= d;
      if (p.shieldHp <= 0) p.shielded = false;
      this.spawnHit(p.x, p.y, '#00d4ff');
      p.invul = 0.5;
      return;
    }
    p.hp -= d;
    p.damageTaken += d;
    p.invul = 1.6;
    this.spawnExplosion(p.x, p.y, p.ship.color);
    audio.play('damage');
    if (p.hp <= 0) {
      this.state = 'lost';
      audio.stopMusic();
      this.finalize(false);
    }
  }

  private spawnHit(x: number, y: number, color: string) {
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random()-0.5)*180,
        vy: (Math.random()-0.5)*180,
        life: 0.3, maxLife: 0.3,
        color, size: 3,
      });
    }
  }
  private spawnExplosion(x: number, y: number, color: string) {
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random()-0.5)*300,
        vy: (Math.random()-0.5)*300,
        life: 0.6, maxLife: 0.6,
        color, size: 4,
      });
    }
  }

  private checkEndConditions() {
    if (this.state !== 'running') return;
    if (this.level.isBoss) {
      // Safety net: if the intro wave is fully cleared but the boss hasn't been
      // spawned yet (race in advanceWaves), force-spawn here.
      if (!this.bossSpawned &&
          this.waveIndex >= this.level.waves.length &&
          this.enemies.length === 0 &&
          this.frame > 60) {
        const m = modsFor(this.level.id);
        // HP is taken straight from BOSS_SPECS — boss HP already encodes per-level scaling.
      this.boss = spawnBoss(this.level.boss!, this.level.id, 1);
        this.bossSpawned = true;
        console.log(`[boss] force-spawned ${this.level.boss} on level ${this.level.id}`);
        return;
      }
      // Win only after the boss has actually appeared and been defeated.
      if (this.bossSpawned && this.boss === null && this.enemies.length === 0 && this.frame > 60) {
        this.state = 'won';
        this.finalize(true);
      }
    } else {
      if (this.waveIndex >= this.level.waves.length && this.enemies.length === 0 && this.frame > 120) {
        this.state = 'won';
        this.finalize(true);
      }
    }
  }

  private finalize(won: boolean) {
    const result: RunResult = {
      player: this.playerAddr,
      levelId: this.level.id,
      seed: this.level.seedSalt,
      score: this.player.score,
      enemiesKilled: this.player.enemiesKilled,
      bossKilled: this.level.isBoss && won,
      duration: this.elapsedMs / 1000,
      damageDealt: this.player.damageDealt,
      damageTaken: this.player.damageTaken,
      inputs: this.inputsForRun,
      framesElapsed: this.frame,
      ts: Date.now(),
    };
    if (won) {
      audio.play('level-clear');
      audio.stopMusic();
      // Persist score + powerup state into the next level.
      this.carriedScore = this.player.score;
      this.carriedKills = this.player.enemiesKilled;
      this.carriedBombs = this.player.bombs;
      this.carriedLives = this.player.hp;
      this.carriedArmor = this.player.armor;
      this.carriedExtraShots = this.player.extraShots;
      this.carriedRapidFire = this.player.rapidFire;
      this.carriedWeaponMode = this.player.weaponMode;
      this.carriedWingmen = this.player.wingmenSlots.length;
      this.events.onLevelComplete(result);
    } else {
      // Death — reset accumulated state.
      this.carriedScore = 0;
      this.carriedKills = 0;
      this.carriedBombs = 2;
      this.carriedLives = null;
      this.carriedArmor = 0;
      this.carriedExtraShots = 0;
      this.carriedRapidFire = false;
      this.carriedWingmen = 0;
      // Fresh loot scenario on the next run: forget which kinds dropped
      // in the previous (failed) attempt so the no-3-in-a-row history
      // doesn't accidentally carry across runs. Math.random()-based RNG
      // already gives different drops; clearing recentDrops also lets
      // any kind appear again immediately.
      this.recentDrops = [];
      this.carriedWeaponMode = 'normal';
      this.carriedWingmen = 0;
      this.events.onGameOver(result);
    }
  }

  draw() {
    this.renderer.clear(this.level?.background ?? 0);
    for (const p of this.particles) this.renderer.drawParticle(p);
    for (const b of this.bullets) this.renderer.drawBullet(b);
    for (const u of this.powerups) this.renderer.drawPowerup(u);
    for (const e of this.enemies) this.renderer.drawEnemy(e);
    if (this.boss) this.renderer.drawBoss(this.boss);
    if (this.player) this.renderer.drawPlayer(this.player);
    if (this.bombAnim) this.renderer.drawBombAnim(this.bombAnim);

    if (this.flashTextMsg) {
      this.flashTextMsg.t += FIXED_DT;
      const ttl = 1.0;
      if (this.flashTextMsg.t < ttl) {
        const alpha = 1 - this.flashTextMsg.t / ttl;
        this.renderer.drawCenter(this.flashTextMsg.text, 200 - this.flashTextMsg.t * 60, this.flashTextMsg.color, 12, alpha);
      } else {
        this.flashTextMsg = null;
      }
    }

    if (this.state === 'won') {
      this.renderer.drawCenter('LEVEL CLEAR', 280, '#4cff7a', 18);
      this.renderer.drawCenter(`+${this.level.rewardStrk} POINTS`, 310, '#ffd84d', 12);
    } else if (this.state === 'lost') {
      this.renderer.drawCenter('GAME OVER', 280, '#ff4860', 18);
    }
  }
}

function mkPlayerBullet(x: number, y: number, vx: number, vy: number, damage: number, color: string, size = 3): Bullet {
  return { x, y, vx, vy, owner: 'player', damage, color, size, life: 2 };
}
