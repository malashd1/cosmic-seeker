// Loot drops + powerups.
// On enemy death there's a small chance to spawn a powerup that drifts downward.
// Player touches it → effect applied to PlayerState until death.

export type PowerupKind =
  | 'life'        // +1 HP
  | 'bomb'        // +1 bomb
  | 'laser'       // upgrade weapon to laser (replaces default)
  | 'plasma'      // upgrade weapon to plasma (bigger orb, larger hit radius)
  | 'rocket'      // upgrade weapon to rocket (AoE on hit)
  | 'double'      // +1 shot per fire (stacks once)
  | 'armor'       // +1 armor (visible module)
  | 'rapid'       // +50% fire rate
  | 'points';     // +500 points

export interface Powerup {
  kind: PowerupKind;
  x: number; y: number;
  vx: number; vy: number;
  age: number;
}

export interface PowerupSpec {
  kind: PowerupKind;
  color: string;
  glyph: string;        // single-character HUD glyph
  weight: number;       // relative drop weight
  label: string;
  desc: string;         // long-form explanation for the in-game legend
}

export const POWERUP_SPECS: Record<PowerupKind, PowerupSpec> = {
  life:   { kind: 'life',   color: '#ff4860', glyph: '♥', weight: 4, label: 'EXTRA LIFE',  desc: '+1 HP. Stacks.' },
  bomb:   { kind: 'bomb',   color: '#ffd84d', glyph: 'B', weight: 6, label: 'BOMB',        desc: '+1 screen-clearing bomb (press X).' },
  laser:  { kind: 'laser',  color: '#00d4ff', glyph: 'L', weight: 5, label: 'LASER',       desc: 'High-velocity beam. Replaces weapon.' },
  plasma: { kind: 'plasma', color: '#ff3df0', glyph: 'P', weight: 4, label: 'PLASMA ORB',  desc: 'Large orb with generous hit radius. Heavy damage.' },
  rocket: { kind: 'rocket', color: '#ff8c1a', glyph: 'R', weight: 1, label: 'ROCKET',      desc: 'AoE explosion (35 px). Very rare drop (~1 per 10 levels).' },
  double: { kind: 'double', color: '#4cff7a', glyph: 'D', weight: 5, label: '+1 SIDE SHOT',desc: '+1 side projectile. Pick up twice → triple.' },
  armor:  { kind: 'armor',  color: '#9ad0ff', glyph: 'A', weight: 4, label: 'ARMOR',       desc: 'Absorbs 1 hit before HP. Visible plates on the ship.' },
  rapid:  { kind: 'rapid',  color: '#fff',    glyph: 'F', weight: 4, label: 'RAPID FIRE',  desc: '+55% fire rate.' },
  points: { kind: 'points', color: '#ffd84d', glyph: '$', weight: 6, label: '+100 PTS',    desc: 'Instant +100 score.' },
};

const TABLE: PowerupKind[] = [];
for (const [k, s] of Object.entries(POWERUP_SPECS)) {
  for (let i = 0; i < s.weight; i++) TABLE.push(k as PowerupKind);
}

/// 18% drop chance on enemy death. Boss kills always drop something good.
export const DROP_CHANCE = 0.18;

export function rollDrop(rng: () => number): PowerupKind | null {
  if (rng() > DROP_CHANCE) return null;
  return TABLE[Math.floor(rng() * TABLE.length)];
}

export function bossDrop(rng: () => number): PowerupKind {
  // Bosses drop a powerful upgrade.
  const pool: PowerupKind[] = ['life', 'armor', 'laser', 'plasma', 'rocket', 'double', 'rapid', 'bomb'];
  return pool[Math.floor(rng() * pool.length)];
}

export function spawnPowerup(kind: PowerupKind, x: number, y: number): Powerup {
  return { kind, x, y, vx: 0, vy: 60, age: 0 };
}
