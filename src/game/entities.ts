import type { EnemyKind, EnemySpec, ShipSpec, WeaponSpec, Vec } from './types';
import { ENEMY_SPECS } from './enemies';
import type { RNG } from './rng';

export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  owner: 'player' | 'enemy';
  damage: number;
  color: string;
  size: number;
  homing?: boolean;
  life: number;
  reflectable?: boolean;
  aoeRadius?: number;     // if set, on hit deals damage to enemies in radius
  visualKind?: 'normal' | 'plasma' | 'rocket' | 'laser';
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  spec: EnemySpec;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  age: number;          // seconds since spawn
  state: 'enter' | 'formation' | 'dive' | 'retreat' | 'kamikaze' | 'invisible';
  anchorX: number;
  anchorY: number;
  diveTarget?: Vec;
  formationGroup: number;
  // per-kind state:
  weaveOffset?: number;
  splitterChildren?: number;
  teleportCooldown?: number;
  invisStartedAt?: number;     // age (seconds) when phantom went invisible
}

export interface PlayerState {
  ship: ShipSpec;
  weapons: WeaponSpec[];
  x: number; y: number;
  hp: number;
  fireCooldown: number;
  invul: number;        // seconds
  bombs: number;
  score: number;
  combo: number;
  comboTimer: number;
  enemiesKilled: number;
  damageDealt: number;
  damageTaken: number;
  shielded: boolean;
  shieldHp: number;
  // Powerup state (resets on death).
  armor: number;
  extraShots: number;   // 0 = single, 1 = double, 2 = triple (cap)
  rapidFire: boolean;
  weaponMode: 'normal' | 'laser' | 'plasma' | 'rocket' | 'homing-rocket';
  // X-offsets (relative to player.x) of the live wingmen. Length 0..2.
  // A wingman drops out of this list when it takes a hit.
  wingmenSlots: number[];
}

export const WINGMAN_OFFSETS: [number, number] = [-28, 28];
export const WINGMAN_HIT_RADIUS = 11;

let _id = 1;
export const nextId = () => _id++;

export function spawnEnemy(
  kind: EnemyKind, x: number, y: number,
  hpMul: number, speedMul: number, fireRateMul: number,
  formationGroup: number,
): Enemy {
  const spec = ENEMY_SPECS[kind];
  // Clamp anchorX safely inside the playable area so the formation drift
  // (±30px wobble) never pushes the enemy off-screen permanently.
  const safeX = Math.max(50, Math.min(480 - 50, x));
  // anchorY range scaled for the 960-tall portrait canvas — original H=640
  // used [60, 220] (top 9–34 %); for H=960 we keep the same ratio →
  // [90, 360]. Enemies occupy the top third, leaving a sane dodge corridor
  // above the player at y=900.
  return {
    id: nextId(),
    kind,
    spec,
    x, y,
    vx: 0, vy: spec.speed * speedMul * 0.5,
    // `round` (not `ceil`) so a multiplier of e.g. 1.05 doesn't jump a
    // 1-HP spec straight to 2 (which is what made L2 grunts feel like
    // boss enemies). `max(1, …)` keeps the floor at 1 — enemies never
    // spawn dead.
    hp: Math.max(1, Math.round(spec.hp * hpMul)),
    maxHp: Math.max(1, Math.round(spec.hp * hpMul)),
    // Tight initial cooldown so enemies open fire ~0.3 s after they reach the
    // formation, not 2-3 s. The previous formula used `1/fireRate + 0.5`
    // which meant a grunt (fireRate 0.5) waited 2.5 s before the first shot —
    // entire opening waves passed without enemy fire.
    fireCooldown: 0.3 + Math.random() * 0.4,
    age: 0,
    state: 'enter',
    anchorX: safeX,
    anchorY: Math.max(90, Math.min(360, Math.abs(safeX) % 360)),
    formationGroup,
    weaveOffset: Math.random() * Math.PI * 2,
    splitterChildren: 0,
    teleportCooldown: 1.5,
  };
}
