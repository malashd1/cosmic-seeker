import type { Enemy, Bullet, Particle, PlayerState } from './entities';
import { getAtlas, type SpriteAtlas } from './spriteAtlas';
import { POWERUP_SPECS, type Powerup } from './powerups';

const W = 480;
const H = 960;
const CONTROL_BAND_H = 220;
const PLAYABLE_BOTTOM = H - CONTROL_BAND_H;

// On touch devices the dedicated CSS control-band div (touchControls.ts)
// renders its own purple top accent that anchors precisely to the
// joystick / FIRE / BOMB area. Drawing the canvas cyan playable-floor
// line on top of that gives the player TWO parallel horizontal lines
// because the canvas is `object-fit: contain` letterboxed and the DOM
// band is anchored to the viewport bottom — the two never line up on
// non-2:1 phone screens. Suppress the canvas line on touch layouts.
const IS_TOUCH_LAYOUT =
  typeof window !== 'undefined' &&
  (matchMedia('(hover: none) and (pointer: coarse)').matches
    || matchMedia('(max-width: 520px)').matches
    || 'ontouchstart' in window);

// ── Boss sprite atlas ──────────────────────────────────────────────
// public/sprites/bosses.png is a 320×128 PNG containing 10 boss sprites
// arranged 5 across × 2 down. Each cell is 64×64.
const BOSS_ATLAS_CELL = 64;
const BOSS_ATLAS_INDEX: Record<string, number> = {
  carrier:    0,   // L10 — purple horned beetle
  hive:       1,   // L20 — cyan/blue spider
  warden:     2,   // L30 — red armored bug
  inquisitor: 3,   // L40 — green mantis
  leviathan:  4,   // L50 — blue arachnid
  architect:  5,   // L60 — orange/yellow mech bug
  devourer:   6,   // L70 — red demon bug
  echo:       7,   // L80 — green segmented centipede
  cataclysm:  8,   // L90 — pink/magenta four-arms
  sovereign:  9,   // L100 — royal blue jellyfish king
};
const bossAtlasImg = new Image();
let bossAtlasReady = false;
bossAtlasImg.onload = () => { bossAtlasReady = true; };
bossAtlasImg.src = '/sprites/bosses.png';

// ── 10 alien-bug boss palettes ─────────────────────────────────────
// Inspired by the player-supplied pixel-art reference. Each entry defines a
// distinct insectoid alien: body colour, trim stripes, horn/leg colour, central
// glowing eye, optional extra eye-spots and a crown for the final boss.
interface BossVisCfg {
  body: string;      // primary body fill
  trim: string;      // stripe / armour-plate accent
  horns: string;     // mandibles + leg claws
  eye: string;       // central pulsing eye + HP bar
  hornCount: number; // 0..4 (paired)
  legCount: number;  // 2..8 (paired)
  eyeSpots?: number; // extra dots on body, paired
  crown?: boolean;
}

const BOSS_VIS: Record<string, BossVisCfg> = {
  // L10 — purple horned beetle (carrier of the swarm)
  carrier:    { body: '#9d4dff', trim: '#ff3df0', horns: '#ffd84d', eye: '#ffd84d', hornCount: 2, legCount: 4 },
  // L20 — cyan spider with the red eye
  hive:       { body: '#00d4ff', trim: '#0066ff', horns: '#ff8c1a', eye: '#ff4860', hornCount: 2, legCount: 6, eyeSpots: 2 },
  // L30 — red bug with orange spikes
  warden:     { body: '#ff4860', trim: '#9d4dff', horns: '#ff8c1a', eye: '#ffd84d', hornCount: 4, legCount: 4 },
  // L40 — green mantis with magenta wings
  inquisitor: { body: '#4cff7a', trim: '#ff3df0', horns: '#ffd84d', eye: '#ffd84d', hornCount: 2, legCount: 6, eyeSpots: 2 },
  // L50 — blue arachnid with orange core
  leviathan:  { body: '#3b99fc', trim: '#0052ff', horns: '#ff4860', eye: '#ff8c1a', hornCount: 4, legCount: 8 },
  // L60 — orange/yellow with cyan center, architect-eye
  architect:  { body: '#ff8c1a', trim: '#ffd84d', horns: '#9d4dff', eye: '#9d4dff', hornCount: 2, legCount: 4, eyeSpots: 2 },
  // L70 — red devourer with prominent horns
  devourer:   { body: '#ff0044', trim: '#ff3df0', horns: '#ffd84d', eye: '#ffd84d', hornCount: 4, legCount: 6 },
  // L80 — green centipede / echo
  echo:       { body: '#4cff7a', trim: '#3b99fc', horns: '#ffd84d', eye: '#ff4860', hornCount: 2, legCount: 8, eyeSpots: 4 },
  // L90 — magenta cataclysm with cyan eye
  cataclysm:  { body: '#ff3df0', trim: '#9d4dff', horns: '#ffd84d', eye: '#00d4ff', hornCount: 4, legCount: 6, eyeSpots: 2 },
  // L100 — sovereign, crowned blue jellyfish-bug
  sovereign:  { body: '#0052ff', trim: '#3b99fc', horns: '#ffd84d', eye: '#ff4860', hornCount: 4, legCount: 8, eyeSpots: 4, crown: true },
};

export class Renderer {
  ctx: CanvasRenderingContext2D;
  stars: Array<{ x: number; y: number; s: number; v: number }> = [];
  atlas: SpriteAtlas | null = null;
  useAtlas = true;
  private flashSpriteCache: (HTMLCanvasElement | null)[] = new Array(10).fill(null);

  /** Returns (and lazily builds) a 64×64 offscreen canvas where every
   *  non-transparent pixel of the boss sprite is recoloured pure white.
   *  Used as a silhouette stamp on hit so the flash never bleeds outside the
   *  boss's actual shape. */
  getFlashSprite(idx: number): HTMLCanvasElement | null {
    if (!bossAtlasReady) return null;
    let c = this.flashSpriteCache[idx];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = BOSS_ATLAS_CELL;
    c.height = BOSS_ATLAS_CELL;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    const col = idx % 5;
    const row = Math.floor(idx / 5);
    cx.drawImage(bossAtlasImg,
                 col * BOSS_ATLAS_CELL, row * BOSS_ATLAS_CELL,
                 BOSS_ATLAS_CELL, BOSS_ATLAS_CELL,
                 0, 0, BOSS_ATLAS_CELL, BOSS_ATLAS_CELL);
    // Recolour with source-in so alpha is preserved, colour is white.
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, BOSS_ATLAS_CELL, BOSS_ATLAS_CELL);
    this.flashSpriteCache[idx] = c;
    return c;
  }

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    try { this.atlas = getAtlas(); } catch { this.atlas = null; }
    this.initStars();
  }

  private initStars() {
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: Math.random() < 0.15 ? 2 : 1,
        v: 20 + Math.random() * 80,
      });
    }
  }

  updateStars(dt: number) {
    for (const s of this.stars) {
      s.y += s.v * dt;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }
  }

  clear(palette: number) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const tints: Array<[string, string]> = [
      ['#0a0014', '#000'],
      ['#0a0028', '#000'],
      ['#001428', '#000'],
      ['#0a0a28', '#000'],
      ['#1a0028', '#000'],
      ['#280014', '#000'],
      ['#001a14', '#000'],
    ];
    const [a, b] = tints[palette % tints.length];
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = s.s === 2 ? 0.9 : 0.5;
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // Playable-area floor — cyan line at PLAYABLE_BOTTOM so the player
    // can see where the no-fly zone (touch-controls band) starts.
    // Skipped on touch layouts where the DOM control-band already paints
    // its own (correctly-anchored) top accent line; see IS_TOUCH_LAYOUT.
    if (!IS_TOUCH_LAYOUT) {
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#00d4ff';
      ctx.fillStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.fillRect(0, PLAYABLE_BOTTOM - 1, W, 2);
      ctx.restore();
    }
  }

  drawPlayer(p: PlayerState) {
    const ctx = this.ctx;
    if (p.invul > 0 && Math.floor(p.invul * 20) % 2 === 0) return;

    if (this.useAtlas && this.atlas) {
      // Wingmen — smaller mirror ships at their live offsets.
      for (const off of p.wingmenSlots) {
        const sx = p.x + off;
        ctx.save();
        ctx.scale(0.85, 0.85);
        this.atlas.blitShip(ctx, p.ship.id, sx / 0.85, p.y / 0.85 + 6);
        ctx.restore();
      }
      this.atlas.blitShip(ctx, p.ship.id, p.x, p.y);
      // Armor modules — visible plates around the ship.
      if (p.armor > 0) {
        ctx.fillStyle = '#9ad0ff';
        ctx.shadowBlur = 6; ctx.shadowColor = '#9ad0ff';
        for (let i = 0; i < Math.min(3, p.armor); i++) {
          ctx.fillRect(p.x - 14 - i * 2, p.y + 2, 3, 8);
          ctx.fillRect(p.x + 11 + i * 2, p.y + 2, 3, 8);
        }
        ctx.shadowBlur = 0;
      }
      if (p.shielded) {
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }

    ctx.fillStyle = p.ship.color;
    // body
    ctx.fillRect(p.x - 2, p.y - 10, 4, 18);
    // wings
    ctx.fillRect(p.x - 10, p.y - 2, 20, 6);
    ctx.fillRect(p.x - 6, p.y - 6, 12, 4);
    // engines
    ctx.fillStyle = '#ffd84d';
    ctx.fillRect(p.x - 8, p.y + 4, 3, 4);
    ctx.fillRect(p.x + 5, p.y + 4, 3, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - 1, p.y - 12, 2, 4);

    if (p.shielded) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawEnemy(e: Enemy) {
    const ctx = this.ctx;
    if (e.state === 'invisible') {
      // Always at least 40% alpha so the player can still locate phantoms.
      ctx.globalAlpha = 0.4 + Math.sin(e.age * 8) * 0.15;
    }

    if (this.useAtlas && this.atlas) {
      this.atlas.blitEnemy(ctx, e.kind, e.x, e.y);
      // hp bar reused below
      if (e.hp < e.maxHp) {
        const s = e.spec.size;
        const w = s * 2;
        ctx.fillStyle = '#400';
        ctx.fillRect(e.x - s, e.y - s - 4, w, 2);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(e.x - s, e.y - s - 4, w * (e.hp / e.maxHp), 2);
      }
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = e.spec.color;
    const s = e.spec.size;

    // each kind has a distinct silhouette
    switch (e.kind) {
      case 'grunt':
        ctx.fillRect(e.x - s, e.y - s + 2, s * 2, s * 2 - 4);
        ctx.fillRect(e.x - s + 2, e.y + s - 4, 2, 2);
        ctx.fillRect(e.x + s - 4, e.y + s - 4, 2, 2);
        break;
      case 'drone':
        ctx.beginPath();
        ctx.arc(e.x, e.y, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(e.x - 1, e.y - 1, 2, 2);
        break;
      case 'scout':
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - s);
        ctx.lineTo(e.x + s, e.y + s);
        ctx.lineTo(e.x - s, e.y + s);
        ctx.closePath();
        ctx.fill();
        break;
      case 'sniper':
        ctx.fillRect(e.x - s, e.y - 4, s * 2, 8);
        ctx.fillRect(e.x - 2, e.y + 4, 4, s);
        break;
      case 'bomber':
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, s, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff4860';
        ctx.fillRect(e.x - 4, e.y + s * 0.4, 8, 2);
        break;
      case 'splitter':
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - s);
        ctx.lineTo(e.x + s, e.y);
        ctx.lineTo(e.x, e.y + s);
        ctx.lineTo(e.x - s, e.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x - s + 2, e.y);
        ctx.lineTo(e.x + s - 2, e.y);
        ctx.stroke();
        break;
      case 'phantom':
        ctx.globalAlpha *= 0.7;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - s);
        ctx.lineTo(e.x + s, e.y);
        ctx.lineTo(e.x, e.y + s);
        ctx.lineTo(e.x - s, e.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case 'swarmer':
        ctx.beginPath();
        ctx.arc(e.x, e.y, s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'turret':
        ctx.fillRect(e.x - s, e.y - s, s * 2, s * 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(e.x - 2, e.y - 2, 4, 4);
        ctx.fillStyle = '#ff4860';
        ctx.fillRect(e.x - 1, e.y + s - 4, 2, 6);
        break;
      case 'reaper':
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - s);
        ctx.lineTo(e.x + s, e.y - s/2);
        ctx.lineTo(e.x + s/2, e.y + s);
        ctx.lineTo(e.x - s/2, e.y + s);
        ctx.lineTo(e.x - s, e.y - s/2);
        ctx.closePath();
        ctx.fill();
        break;
      case 'mirror':
        ctx.fillRect(e.x - s, e.y - 2, s * 2, 4);
        ctx.fillRect(e.x - 2, e.y - s, 4, s * 2);
        break;
      case 'voidling':
        ctx.fillStyle = '#1a0033';
        ctx.beginPath();
        ctx.arc(e.x, e.y, s + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9d4dff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, s - 2, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    // hp bar
    if (e.hp < e.maxHp) {
      const w = s * 2;
      ctx.fillStyle = '#400';
      ctx.fillRect(e.x - s, e.y - s - 4, w, 2);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(e.x - s, e.y - s - 4, w * (e.hp / e.maxHp), 2);
    }
    ctx.globalAlpha = 1;
  }

  drawBullet(b: Bullet) {
    const ctx = this.ctx;
    const kind = b.visualKind ?? 'normal';
    if (kind === 'plasma') {
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (kind === 'rocket') {
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - 3, b.y - 6, 6, 10);
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x - 1, b.y - 6, 2, 4);
      ctx.fillStyle = '#ff4860';
      ctx.fillRect(b.x - 2, b.y + 4, 4, 4);
      ctx.restore();
      return;
    }
    if (kind === 'laser') {
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = b.color;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - 1, b.y - b.size * 4, 2, b.size * 8);
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x, b.y - b.size * 3, 1, b.size * 6);
      ctx.restore();
      return;
    }
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x - b.size, b.y - b.size, b.size * 2, b.size * 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
  }

  drawParticle(p: Particle) {
    const ctx = this.ctx;
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const s = p.size * a;
    ctx.fillRect(p.x - s/2, p.y - s/2, s, s);
    ctx.globalAlpha = 1;
  }

  /// Insectoid alien-bug bosses with central glowing eye, animated legs, pincer horns.
  /// Each kind has a distinct color palette, horn shape, leg count and body silhouette.
  drawBoss(boss: { x: number; y: number; hp: number; maxHp: number; kind: string; w: number; h: number; color: string; flash: number; age?: number }) {
    const ctx = this.ctx;
    const t = boss.age ?? performance.now() / 1000;
    const flash = boss.flash > 0;
    const cfg = BOSS_VIS[boss.kind] ?? BOSS_VIS.carrier;

    // ── Atlas-backed render (preferred): blit the player-supplied sprite.
    if (bossAtlasReady) {
      const idx = BOSS_ATLAS_INDEX[boss.kind] ?? 0;
      const col = idx % 5;
      const row = Math.floor(idx / 5);
      const sx = col * BOSS_ATLAS_CELL;
      const sy = row * BOSS_ATLAS_CELL;
      // Pulse scale + idle bob for life.
      const scale = (Math.min(boss.w, boss.h) / BOSS_ATLAS_CELL) * (1 + Math.sin(t * 3) * 0.04);
      const drawW = BOSS_ATLAS_CELL * scale;
      const drawH = BOSS_ATLAS_CELL * scale;
      const dx = boss.x - drawW/2;
      const dy = boss.y - drawH/2;

      // Cache a tinted "flash" version of each boss sprite. It's the same image
      // but every non-transparent pixel is white — flash uses the sprite's own
      // alpha mask, so the white-out follows the silhouette exactly.
      const tinted = this.getFlashSprite(idx);

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      // Coloured glow that hugs the silhouette: use a soft shadow on the sprite blit.
      ctx.shadowBlur = 18;
      ctx.shadowColor = cfg.eye;
      ctx.drawImage(bossAtlasImg, sx, sy, BOSS_ATLAS_CELL, BOSS_ATLAS_CELL, dx, dy, drawW, drawH);
      ctx.shadowBlur = 0;
      if (flash && tinted) {
        // Stamp the silhouette-shaped white overlay. Because `tinted` itself
        // is shaped like the boss (alpha matches), the flash never leaks into
        // the transparent cell padding.
        ctx.globalAlpha = 0.85;
        ctx.drawImage(tinted, dx, dy, drawW, drawH);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // HP bar at top
      const ratio = Math.max(0, boss.hp / boss.maxHp);
      ctx.fillStyle = '#400';
      ctx.fillRect(40, 40, W - 80, 8);
      ctx.fillStyle = cfg.eye;
      ctx.fillRect(40, 40, (W - 80) * ratio, 8);
      ctx.fillStyle = '#fff';
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(boss.kind.toUpperCase(), 40, 36);
      return;
    }

    // ── Procedural fallback while the PNG is still loading.
    ctx.save();
    ctx.translate(boss.x, boss.y);

    const body = flash ? '#fff' : cfg.body;
    const trim = flash ? '#fff' : cfg.trim;
    const eye  = flash ? '#fff' : cfg.eye;
    const w2 = boss.w / 2;
    const h2 = boss.h / 2;

    ctx.shadowBlur = 18;
    ctx.shadowColor = cfg.body;

    // ── body (rounded organic blob)
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, w2 * 0.78, h2 * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── trim plates over body (gives the "alien bug" striping)
    ctx.fillStyle = trim;
    for (let i = 0; i < 3; i++) {
      const r = (i + 1) * 0.22;
      ctx.beginPath();
      ctx.ellipse(0, -h2 * 0.15 + i * 6, w2 * (0.74 - i * 0.12), h2 * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── horns / mandibles (curved pair on top)
    ctx.strokeStyle = cfg.horns;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const hornCount = cfg.hornCount;
    for (let i = 0; i < hornCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const baseX = side * w2 * (0.45 - tier * 0.12);
      const baseY = -h2 * 0.55;
      const tipX  = side * w2 * (0.65 + tier * 0.10);
      const tipY  = -h2 * (1.05 + tier * 0.18);
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(side * w2 * 0.85, -h2 * 0.85, tipX, tipY);
      ctx.stroke();
    }

    // ── legs / wings (multiple curved segments below)
    ctx.strokeStyle = body;
    ctx.lineWidth = 3.5;
    const legs = cfg.legCount;
    for (let i = 0; i < legs; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const phase = t * 3 + tier * 0.7 + (side > 0 ? Math.PI : 0);
      const baseX = side * w2 * 0.55;
      const baseY = h2 * (-0.1 + tier * 0.25);
      const midX  = side * w2 * (0.95 + Math.sin(phase) * 0.05);
      const midY  = baseY + h2 * 0.35 + Math.cos(phase) * 4;
      const tipX  = side * w2 * (1.05 + Math.sin(phase) * 0.08);
      const tipY  = baseY + h2 * 0.9;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
      // claw tip
      ctx.fillStyle = cfg.horns;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── central glowing eye (pulses with HP)
    const pulse = 1 + Math.sin(t * 4) * 0.12;
    const eyeR = h2 * 0.28 * pulse;
    ctx.shadowBlur = 22;
    ctx.shadowColor = eye;
    // outer iris
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.ellipse(0, 0, eyeR * 1.4, eyeR, 0, 0, Math.PI * 2);
    ctx.fill();
    // pupil
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(Math.sin(t * 1.5) * eyeR * 0.4, 0, eyeR * 0.5, eyeR * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-eyeR * 0.3, -eyeR * 0.4, eyeR * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // ── secondary eye-spots on body (gives that "many-eyed alien" look)
    if (cfg.eyeSpots) {
      ctx.fillStyle = cfg.horns;
      ctx.shadowBlur = 8;
      ctx.shadowColor = cfg.horns;
      for (let i = 0; i < cfg.eyeSpots; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const tier = Math.floor(i / 2);
        const x = side * w2 * 0.45;
        const y = h2 * (0.25 + tier * 0.25);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── crown for Sovereign (king-of-bugs)
    if (cfg.crown) {
      ctx.fillStyle = cfg.horns;
      ctx.shadowBlur = 10;
      ctx.shadowColor = cfg.horns;
      for (let i = -2; i <= 2; i++) {
        const x = i * w2 * 0.18;
        const yTop = -h2 * 1.35 - (i === 0 ? 6 : 0);
        const yBot = -h2 * 1.05;
        ctx.fillRect(x - 3, yTop, 6, yBot - yTop);
      }
    }

    ctx.restore();

    // ── HP bar at top of screen
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    ctx.fillStyle = '#400';
    ctx.fillRect(40, 40, W - 80, 8);
    ctx.fillStyle = cfg.eye;
    ctx.fillRect(40, 40, (W - 80) * ratio, 8);
    ctx.fillStyle = '#fff';
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillText(boss.kind.toUpperCase(), 40, 36);
  }

  drawText(text: string, x: number, y: number, color = '#fff', size = 10) {
    this.ctx.fillStyle = color;
    this.ctx.font = `${size}px "Press Start 2P", monospace`;
    this.ctx.fillText(text, x, y);
  }

  drawCenter(text: string, y: number, color = '#fff', size = 14, alpha = 1) {
    const ctx = this.ctx;
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `${size}px "Press Start 2P", monospace`;
    const m = ctx.measureText(text);
    ctx.fillText(text, (W - m.width) / 2, y);
    ctx.globalAlpha = prevA;
  }

  drawPowerup(u: Powerup) {
    const ctx = this.ctx;
    const spec = POWERUP_SPECS[u.kind];
    const pulse = 1 + Math.sin(u.age * 8) * 0.15;
    const r = 10 * pulse;
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = spec.color;
    ctx.fillStyle = spec.color;
    // diamond shape
    ctx.beginPath();
    ctx.moveTo(u.x, u.y - r);
    ctx.lineTo(u.x + r, u.y);
    ctx.lineTo(u.x, u.y + r);
    ctx.lineTo(u.x - r, u.y);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.font = '10px "Press Start 2P", monospace';
    const m = ctx.measureText(spec.glyph);
    ctx.fillText(spec.glyph, u.x - m.width / 2, u.y + 4);
    ctx.restore();
  }

  drawBombAnim(b: { x: number; y: number; t: number }) {
    const ctx = this.ctx;
    ctx.save();
    const flicker = (Math.floor(b.t * 30) % 2) === 0 ? '#ffd84d' : '#ff8c1a';
    ctx.fillStyle = flicker;
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ffd84d';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 8 + Math.sin(b.t * 30) * 2, 0, Math.PI * 2);
    ctx.fill();
    // trail
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ff4860';
    ctx.beginPath();
    ctx.arc(b.x, b.y + 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
