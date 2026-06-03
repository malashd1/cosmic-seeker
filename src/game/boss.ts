import type { BossKind } from './types';
import type { Bullet, Enemy } from './entities';
import { BOSS_SPECS } from './enemies';
import { spawnEnemy } from './entities';

export interface Boss {
  kind: BossKind;
  x: number; y: number;
  vx: number;
  hp: number;
  maxHp: number;
  w: number;
  h: number;
  color: string;
  phase: number;
  phaseTimer: number;
  fireTimer: number;
  flash: number;
  spawnPool: Enemy[];
  level: number;
  age: number;
}

const COLORS: Record<BossKind, string> = {
  carrier: '#4cff7a',
  hive: '#ff8c1a',
  warden: '#a0a0ff',
  inquisitor: '#ff3df0',
  leviathan: '#00d4ff',
  architect: '#ffd84d',
  devourer: '#ff0044',
  echo: '#c0e0ff',
  cataclysm: '#9d4dff',
  sovereign: '#0052ff',
};

export function spawnBoss(kind: BossKind, level: number, hpMul: number): Boss {
  const spec = BOSS_SPECS[kind];
  const sizeBoost = 1 + (spec.level / 100) * 0.5;     // later bosses get visually bigger
  const speedBoost = 80 + spec.level * 1.4;
  return {
    kind,
    x: 240, y: 90,
    vx: speedBoost,
    // round + min-1 for the same reason as regular enemies — `ceil` would
    // bump even a 1× boss hpMul to `spec.hp + 1`.
    hp: Math.max(1, Math.round(spec.hp * hpMul)),
    maxHp: Math.max(1, Math.round(spec.hp * hpMul)),
    w: Math.round(110 * sizeBoost), h: Math.round(64 * sizeBoost),
    color: COLORS[kind],
    phase: 0,
    phaseTimer: 0,
    fireTimer: 0,
    flash: 0,
    spawnPool: [],
    level,
    age: 0,
  };
}

export interface BossUpdateCtx {
  dt: number;
  playerX: number;
  playerY: number;
  spawnBullet: (b: Bullet) => void;
  spawnEnemyExt: (e: Enemy) => void;
  rngNext: () => number;
}

export function updateBoss(b: Boss, ctx: BossUpdateCtx) {
  b.age += ctx.dt;
  b.flash = Math.max(0, b.flash - ctx.dt);
  b.x += b.vx * ctx.dt;
  if (b.x < 60 || b.x > 420) b.vx = -b.vx;
  // gentle vertical wobble — keeps the fight visually alive
  b.y = 90 + Math.sin(b.age * 1.4) * 24;
  b.fireTimer -= ctx.dt;
  b.phaseTimer += ctx.dt;

  // Phase transitions: 75/50/25/10% HP.
  const ratio = b.hp / b.maxHp;
  const expectedPhase = ratio > 0.75 ? 0 : ratio > 0.5 ? 1 : ratio > 0.25 ? 2 : ratio > 0.1 ? 3 : 4;
  if (expectedPhase > b.phase) {
    b.phase = expectedPhase;
    b.phaseTimer = 0;
  }

  const fireBullet = (
    vx: number, vy: number, color: string,
    opts: { size?: number; visual?: 'normal' | 'plasma' | 'rocket' | 'laser'; aoe?: number; homing?: boolean } = {},
  ) => {
    ctx.spawnBullet({
      x: b.x, y: b.y + b.h/2, vx, vy,
      owner: 'enemy', damage: 1,
      color, size: opts.size ?? 4,
      life: 5,
      visualKind: opts.visual,
      aoeRadius: opts.aoe,
      homing: opts.homing,
    });
  };

  const aimedDir = () => {
    const dx = ctx.playerX - b.x;
    const dy = ctx.playerY - b.y;
    const L = Math.hypot(dx, dy) || 1;
    return { dx: dx/L, dy: dy/L };
  };

  switch (b.kind) {
    // ── L10 Carrier ── straight shotgun + drone spawn ─────────────────
    case 'carrier': {
      if (b.fireTimer <= 0) {
        // 3-shot straight shotgun, slow-paced.
        fireBullet(-50, 180, '#ff4860');
        fireBullet(0,   200, '#ff4860');
        fireBullet(50,  180, '#ff4860');
        b.fireTimer = 0.75 - b.phase * 0.05;
      }
      if (b.phaseTimer > 3.5) {
        ctx.spawnEnemyExt(spawnEnemy('drone', b.x - 30, b.y + 30, 1.5, 1, 1, 99));
        ctx.spawnEnemyExt(spawnEnemy('drone', b.x + 30, b.y + 30, 1.5, 1, 1, 99));
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L20 Hive ── plasma cone burst + swarmer wave ──────────────────
    case 'hive': {
      if (b.fireTimer <= 0) {
        // Cone of fat plasma orbs (visually distinct, big collision radius).
        for (let i = -2; i <= 2; i++) {
          fireBullet(i * 50, 180, '#ff8c1a', { size: 7, visual: 'plasma' });
        }
        b.fireTimer = 1.1 - b.phase * 0.1;
      }
      if (b.phaseTimer > 3.5) {
        for (let i = 0; i < 4; i++) {
          ctx.spawnEnemyExt(spawnEnemy('swarmer', b.x + i*15 - 22, b.y + 30, 1, 1.2, 1, 99));
        }
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L30 Warden ── true 360° spread (rotating ring) ────────────────
    case 'warden': {
      if (b.fireTimer <= 0) {
        const n = 10 + b.phase * 2;
        const offset = b.age * 0.8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + offset;
          fireBullet(Math.cos(a) * 150, Math.sin(a) * 150 + 50, '#a0a0ff');
        }
        b.fireTimer = 1.1 - b.phase * 0.12;
      }
      break;
    }

    // ── L40 Inquisitor ── aimed laser sniper + phantom adds ──────────
    case 'inquisitor': {
      if (b.fireTimer <= 0) {
        const { dx, dy } = aimedDir();
        const sp = 320;
        // Single fast laser bolt — visually distinct from regular bullets.
        fireBullet(dx * sp, dy * sp, '#ff3df0', { size: 4, visual: 'laser' });
        // Phase 2+: paired laser flanks.
        if (b.phase >= 1) {
          const aBase = Math.atan2(dy, dx);
          fireBullet(Math.cos(aBase - 0.15) * sp, Math.sin(aBase - 0.15) * sp, '#ff3df0', { size: 4, visual: 'laser' });
          fireBullet(Math.cos(aBase + 0.15) * sp, Math.sin(aBase + 0.15) * sp, '#ff3df0', { size: 4, visual: 'laser' });
        }
        b.fireTimer = 0.6 - b.phase * 0.06;
      }
      if (b.phaseTimer > 5) {
        ctx.spawnEnemyExt(spawnEnemy('phantom', b.x - 40, b.y + 30, 1, 1, 1, 99));
        ctx.spawnEnemyExt(spawnEnemy('phantom', b.x + 40, b.y + 30, 1, 1, 1, 99));
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L50 Leviathan ── sine-wave beams + intermittent rocket ────────
    case 'leviathan': {
      if (b.fireTimer <= 0) {
        const t = b.age * 2.2;
        // 3 lasers sweeping the field like sound-wave radar.
        fireBullet(Math.sin(t)     * 140, 220, '#00d4ff', { size: 3, visual: 'laser' });
        fireBullet(Math.sin(t + 1) * 140, 220, '#00d4ff', { size: 3, visual: 'laser' });
        fireBullet(Math.sin(t + 2) * 140, 220, '#00d4ff', { size: 3, visual: 'laser' });
        b.fireTimer = 0.25;
      }
      if (b.phaseTimer > 3.5) {
        // Periodic AoE rocket aimed roughly at player position.
        const { dx, dy } = aimedDir();
        fireBullet(dx * 180, dy * 180, '#ff4860', { size: 6, visual: 'rocket', aoe: 40 });
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L60 Architect ── grid of turrets + downward column volley ────
    case 'architect': {
      if (b.phaseTimer > 4) {
        ctx.spawnEnemyExt(spawnEnemy('turret', 60, 200, 1, 1, 1, 99));
        ctx.spawnEnemyExt(spawnEnemy('turret', 420, 200, 1, 1, 1, 99));
        b.phaseTimer = 0;
      }
      if (b.fireTimer <= 0) {
        // 5-column volley straight down (defines the "construction beam" look).
        for (let i = -2; i <= 2; i++) fireBullet(i * 60, 240, '#ffd84d', { size: 5 });
        b.fireTimer = 0.75 - b.phase * 0.08;
      }
      // Phase 2+: add a single AoE rocket every cycle.
      if (b.phase >= 2 && b.phaseTimer > 2.5) {
        const { dx, dy } = aimedDir();
        fireBullet(dx * 150, dy * 150, '#ff8c1a', { size: 6, visual: 'rocket', aoe: 50 });
      }
      break;
    }

    // ── L70 Devourer ── pulsing radial rings + homing missile ────────
    case 'devourer': {
      if (b.fireTimer <= 0) {
        // Two interleaved rings (12 + 12 with 15° offset) — bullet-hell flavor.
        const n = 12;
        const o = (b.phaseTimer % 1) * 0.3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + o;
          fireBullet(Math.cos(a) * 130, Math.sin(a) * 130 + 30, '#ff0044');
        }
        b.fireTimer = 0.85 - b.phase * 0.12;
      }
      // Phase 1+: every 4s spit a homing missile.
      if (b.phase >= 1 && b.phaseTimer > 4) {
        fireBullet(0, 80, '#ff4860', { size: 4, visual: 'rocket', homing: true });
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L80 Echo ── predictive shotgun aimed where player will be ────
    case 'echo': {
      if (b.fireTimer <= 0) {
        const { dx, dy } = aimedDir();
        const aBase = Math.atan2(dy, dx);
        const sp = 240;
        // 5-spread shotgun pointed at player; tightens in later phases.
        const spread = 0.32 - b.phase * 0.05;
        for (let i = -2; i <= 2; i++) {
          const a = aBase + i * spread / 2;
          fireBullet(Math.cos(a) * sp, Math.sin(a) * sp, '#c0e0ff');
        }
        b.fireTimer = 0.5 - b.phase * 0.06;
      }
      // Phase 2+: throw a homing bolt on cooldown.
      if (b.phase >= 2 && b.phaseTimer > 3) {
        fireBullet(0, 60, '#fff', { size: 4, homing: true });
        b.phaseTimer = 0;
      }
      break;
    }

    // ── L90 Cataclysm ── rotating dual spirals (true bullet hell) ────
    case 'cataclysm': {
      if (b.fireTimer <= 0) {
        const n = 8 + b.phase * 2;
        const o = b.age * 2;
        // Two counter-rotating spirals.
        for (let i = 0; i < n; i++) {
          const a1 = (i / n) * Math.PI * 2 + o;
          const a2 = (i / n) * Math.PI * 2 - o + Math.PI / n;
          fireBullet(Math.cos(a1) * 110, Math.sin(a1) * 110 + 40, '#9d4dff', { size: 3 });
          fireBullet(Math.cos(a2) * 110, Math.sin(a2) * 110 + 40, '#ff3df0', { size: 3 });
        }
        b.fireTimer = 0.22;
      }
      // Phase 3+: occasional AoE shockwave.
      if (b.phase >= 3 && b.phaseTimer > 2) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          fireBullet(Math.cos(a) * 90, Math.sin(a) * 90 + 30, '#fff', { size: 5, aoe: 25 });
        }
        b.phaseTimer = 0;
      }
      break;
    }
    // ── L100 Sovereign ── composite final boss, cycles 5 patterns ────
    case 'sovereign': {
      const cycle = Math.floor(b.age / 4) % 5;
      if (b.fireTimer <= 0) {
        if (cycle === 0) {
          // Wide spread (carrier roots)
          const n = 14;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI + Math.PI;
            fireBullet(Math.cos(a) * 160, Math.sin(a) * 160 + 60, '#0052ff');
          }
          b.fireTimer = 0.8;
        } else if (cycle === 1) {
          // Aimed laser sniper (inquisitor)
          const { dx, dy } = aimedDir();
          fireBullet(dx * 300, dy * 300, '#fff', { size: 5, visual: 'laser' });
          b.fireTimer = 0.25;
        } else if (cycle === 2) {
          // Counter-rotating hellspiral (cataclysm)
          const n = 10;
          const o = b.age * 3;
          for (let i = 0; i < n; i++) {
            const a1 = (i / n) * Math.PI * 2 + o;
            const a2 = (i / n) * Math.PI * 2 - o + Math.PI / n;
            fireBullet(Math.cos(a1) * 130, Math.sin(a1) * 130 + 30, '#ff3df0', { size: 3 });
            fireBullet(Math.cos(a2) * 130, Math.sin(a2) * 130 + 30, '#ffd84d', { size: 3 });
          }
          b.fireTimer = 0.18;
        } else if (cycle === 3) {
          // AoE rocket + homing bolt combo (leviathan + echo)
          const { dx, dy } = aimedDir();
          fireBullet(dx * 200, dy * 200, '#ff8c1a', { size: 6, visual: 'rocket', aoe: 50 });
          fireBullet(0, 80, '#fff', { size: 4, homing: true });
          b.fireTimer = 1.0;
        } else {
          // Spawn reaper adds (devourer/architect roots)
          ctx.spawnEnemyExt(spawnEnemy('reaper', b.x - 40, b.y + 30, 1, 1, 1, 99));
          ctx.spawnEnemyExt(spawnEnemy('reaper', b.x + 40, b.y + 30, 1, 1, 1, 99));
          b.fireTimer = 1.8;
        }
      }
      break;
    }
  }
}
