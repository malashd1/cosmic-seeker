// Offscreen sprite atlas — pre-renders all 12 enemy species (+ player ship variants)
// into a single canvas at boot. The main renderer blits via drawImage(), which is faster
// than re-issuing N fill() calls per entity per frame and lets us add detail (halos,
// highlights, eyes, drop shadows) without a per-frame cost.

import type { EnemyKind } from './types';
import { SHIPS } from './ships';

const CELL = 32;             // atlas cell size in px
const CENTER = CELL / 2;

const ENEMY_KINDS: EnemyKind[] = [
  'grunt', 'drone', 'scout', 'sniper', 'bomber',
  'splitter', 'phantom', 'swarmer', 'turret',
  'reaper', 'mirror', 'voidling',
];

const ENEMY_COLORS: Record<EnemyKind, string> = {
  grunt: '#ff4860',   drone: '#ff8c1a',  scout: '#ffd84d',
  sniper: '#4cff7a',  bomber: '#00d4ff', splitter: '#ff3df0',
  phantom: '#9d4dff', swarmer: '#ff6b35', turret: '#a0a0a0',
  reaper: '#ff0044',  mirror: '#c0e0ff', voidling: '#9d4dff',
};

export class SpriteAtlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  enemyPos: Map<EnemyKind, [number, number]> = new Map();
  shipPos: Map<string, [number, number]> = new Map();
  cell = CELL;

  constructor() {
    const rows = 2;
    const cols = Math.max(ENEMY_KINDS.length, SHIPS.length);
    const c = document.createElement('canvas');
    c.width = cols * CELL;
    c.height = rows * CELL;
    this.canvas = c;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('SpriteAtlas: no 2D context');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    this.render();
  }

  private render() {
    // Row 0 — enemies
    ENEMY_KINDS.forEach((kind, i) => {
      const x = i * CELL;
      this.enemyPos.set(kind, [x, 0]);
      this.drawEnemy(kind, x, 0);
    });
    // Row 1 — ships
    SHIPS.forEach((ship, i) => {
      const x = i * CELL;
      this.shipPos.set(ship.id, [x, CELL]);
      this.drawShip(ship.id, ship.color, x, CELL);
    });
  }

  blitEnemy(dst: CanvasRenderingContext2D, kind: EnemyKind, dx: number, dy: number) {
    const pos = this.enemyPos.get(kind);
    if (!pos) return;
    dst.drawImage(this.canvas, pos[0], pos[1], CELL, CELL, dx - CENTER, dy - CENTER, CELL, CELL);
  }

  blitShip(dst: CanvasRenderingContext2D, shipId: string, dx: number, dy: number) {
    const pos = this.shipPos.get(shipId);
    if (!pos) return;
    dst.drawImage(this.canvas, pos[0], pos[1], CELL, CELL, dx - CENTER, dy - CENTER, CELL, CELL);
  }

  // ---- enemy painters ----

  private drawEnemy(kind: EnemyKind, x0: number, y0: number) {
    const ctx = this.ctx;
    const color = ENEMY_COLORS[kind];
    ctx.save();
    ctx.translate(x0 + CENTER, y0 + CENTER);

    // halo
    ctx.shadowBlur = 6;
    ctx.shadowColor = color;
    ctx.fillStyle = color;

    switch (kind) {
      case 'grunt':
        ctx.fillRect(-6, -5, 12, 10);
        ctx.fillStyle = '#2a0008';
        ctx.fillRect(-4, -3, 3, 3); ctx.fillRect(1, -3, 3, 3); // eyes
        ctx.fillStyle = color; ctx.fillRect(-7, 4, 3, 2); ctx.fillRect(4, 4, 3, 2);
        break;
      case 'drone':
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(-9, -1, 4, 2); ctx.fillRect(5, -1, 4, 2);
        break;
      case 'scout':
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(-1, -3, 2, 5);
        break;
      case 'sniper':
        ctx.fillRect(-7, -3, 14, 6);
        ctx.fillStyle = '#4cff7a'; ctx.fillRect(-2, 3, 4, 6); // barrel
        ctx.fillStyle = '#fff'; ctx.fillRect(-1, -1, 2, 2);
        break;
      case 'bomber':
        ctx.beginPath(); ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff4860'; ctx.fillRect(-4, 3, 8, 2);
        ctx.fillStyle = '#fff'; ctx.fillRect(-3, -2, 2, 2); ctx.fillRect(1, -2, 2, 2);
        break;
      case 'splitter':
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke();
        break;
      case 'phantom':
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.fillRect(-1, -2, 2, 4);
        break;
      case 'swarmer':
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 10; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
      case 'turret':
        ctx.fillRect(-8, -8, 16, 16);
        ctx.fillStyle = '#404040'; ctx.fillRect(-6, -6, 12, 12);
        ctx.fillStyle = '#fff'; ctx.fillRect(-2, -2, 4, 4);
        ctx.fillStyle = '#ff4860'; ctx.fillRect(-1, 4, 2, 6);
        break;
      case 'reaper':
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(7, -3); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.lineTo(-7, -3); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(-3, -1, 2, 2); ctx.fillRect(1, -1, 2, 2);
        break;
      case 'mirror':
        ctx.fillRect(-7, -1, 14, 3);
        ctx.fillRect(-1, -7, 3, 14);
        ctx.fillStyle = '#fff'; ctx.fillRect(-1, -1, 2, 2);
        break;
      case 'voidling':
        ctx.fillStyle = '#1a0033';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();
  }

  // ---- ship painter ----

  private drawShip(_id: string, color: string, x0: number, y0: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x0 + CENTER, y0 + CENTER);
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    // body
    ctx.fillStyle = color;
    ctx.fillRect(-2, -10, 4, 18);
    // wings
    ctx.fillRect(-10, -2, 20, 6);
    ctx.fillRect(-6, -6, 12, 4);
    // engines
    ctx.fillStyle = '#ffd84d';
    ctx.fillRect(-8, 4, 3, 4);
    ctx.fillRect(5, 4, 3, 4);
    // cockpit
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -12, 2, 4);
    // outline highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-2, -10, 1, 18);
    ctx.restore();
  }
}

// Lazy module-level singleton — only constructed in the browser.
let _atlas: SpriteAtlas | null = null;
export function getAtlas(): SpriteAtlas {
  if (!_atlas) _atlas = new SpriteAtlas();
  return _atlas;
}
