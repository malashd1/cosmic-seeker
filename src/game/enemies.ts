import type { EnemyKind, EnemySpec, BossKind, BossSpec } from './types';

// 12 enemy species. Stats below are BASE stats — scaled per level by difficulty curve.
export const ENEMY_SPECS: Record<EnemyKind, EnemySpec> = {
  grunt: {
    kind: 'grunt', hp: 1, speed: 30, fireRate: 0.25, bulletSpeed: 140,
    reward: 10, color: '#ff4860', size: 12, behavior: 'formation',
  },
  drone: {
    kind: 'drone', hp: 1, speed: 50, fireRate: 0.3, bulletSpeed: 160,
    reward: 15, color: '#ff8c1a', size: 12, behavior: 'dive',
  },
  scout: {
    kind: 'scout', hp: 1, speed: 90, fireRate: 0.4, bulletSpeed: 180,
    reward: 25, color: '#ffd84d', size: 10, behavior: 'weave',
  },
  sniper: {
    kind: 'sniper', hp: 2, speed: 20, fireRate: 0.15, bulletSpeed: 260,
    reward: 40, color: '#4cff7a', size: 14, behavior: 'stationary',
  },
  bomber: {
    kind: 'bomber', hp: 3, speed: 30, fireRate: 0.2, bulletSpeed: 90,
    reward: 55, color: '#00d4ff', size: 16, behavior: 'formation',
  },
  splitter: {
    kind: 'splitter', hp: 2, speed: 40, fireRate: 0.2, bulletSpeed: 150,
    reward: 60, color: '#ff3df0', size: 14, behavior: 'formation',
  },
  phantom: {
    kind: 'phantom', hp: 2, speed: 60, fireRate: 0.3, bulletSpeed: 180,
    reward: 75, color: '#9d4dff', size: 12, behavior: 'dive',
  },
  swarmer: {
    kind: 'swarmer', hp: 1, speed: 120, fireRate: 0, bulletSpeed: 0,
    reward: 35, color: '#ff6b35', size: 8, behavior: 'kamikaze',
  },
  turret: {
    kind: 'turret', hp: 6, speed: 0, fireRate: 0.8, bulletSpeed: 200,
    reward: 100, color: '#a0a0a0', size: 16, behavior: 'stationary',
  },
  reaper: {
    kind: 'reaper', hp: 4, speed: 55, fireRate: 0.2, bulletSpeed: 220,
    reward: 120, color: '#ff0044', size: 14, behavior: 'dive',
  },
  mirror: {
    kind: 'mirror', hp: 3, speed: 40, fireRate: 0.5, bulletSpeed: 200,
    reward: 150, color: '#c0e0ff', size: 13, behavior: 'formation',
  },
  voidling: {
    kind: 'voidling', hp: 5, speed: 200, fireRate: 0, bulletSpeed: 0,
    reward: 180, color: '#1a0033', size: 12, behavior: 'teleport',
  },
};

export const ENEMY_KINDS_BY_TIER: Record<EnemyKind, number> = {
  grunt: 1, drone: 1, scout: 5, sniper: 11, bomber: 16,
  splitter: 21, phantom: 26, swarmer: 31, turret: 36,
  reaper: 51, mirror: 61, voidling: 76,
};

// 10 bosses — every 10th level (10, 20, ..., 100).
// HP curve: ~17× from L10 to L100. NO extra hpMul applied at spawn time.
//   L10 Carrier  →  70    (≈ 14s default weapon, ≈ 5s with double+rapid)
//   L20 Hive     → 130
//   L30 Warden   → 200
//   L40 Inquis.  → 280
//   L50 Leviath. → 370
//   L60 Architect→ 480
//   L70 Devourer → 600
//   L80 Echo     → 750
//   L90 Catacl.  → 920
//   L100 Sovere. → 1200  (≈ 1 min with mid-tier gear, ≈ 30s with rockets+wingman)
export const BOSS_SPECS: Record<BossKind, BossSpec> = {
  carrier:    { kind: 'carrier',    level: 10,  hp: 140,  reward: 1000,  phases: 1 },
  hive:       { kind: 'hive',       level: 20,  hp: 200,  reward: 1500,  phases: 2 },
  warden:     { kind: 'warden',     level: 30,  hp: 240,  reward: 2000,  phases: 2 },
  inquisitor: { kind: 'inquisitor', level: 40,  hp: 280,  reward: 3000,  phases: 3 },
  leviathan:  { kind: 'leviathan',  level: 50,  hp: 370,  reward: 5000,  phases: 3 },
  architect:  { kind: 'architect',  level: 60,  hp: 480,  reward: 7500,  phases: 3 },
  devourer:   { kind: 'devourer',   level: 70,  hp: 600,  reward: 10000, phases: 3 },
  echo:       { kind: 'echo',       level: 80,  hp: 750,  reward: 15000, phases: 4 },
  cataclysm:  { kind: 'cataclysm',  level: 90,  hp: 920,  reward: 25000, phases: 4 },
  sovereign:  { kind: 'sovereign',  level: 100, hp: 1200, reward: 100000, phases: 5 },
};

export const BOSSES_ORDERED: BossKind[] = [
  'carrier', 'hive', 'warden', 'inquisitor', 'leviathan',
  'architect', 'devourer', 'echo', 'cataclysm', 'sovereign',
];

export function availableEnemiesAtLevel(level: number): EnemyKind[] {
  return (Object.keys(ENEMY_KINDS_BY_TIER) as EnemyKind[])
    .filter((k) => ENEMY_KINDS_BY_TIER[k] <= level);
}
