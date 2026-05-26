import type { LevelSpec } from './types';

// Difficulty curve: 0..1 over 100 levels. Slight S-curve.
export function difficultyFor(level: number): number {
  const t = (level - 1) / 99;
  // Smooth-step.
  return t * t * (3 - 2 * t);
}

export function tierFor(level: number): LevelSpec['tier'] {
  if (level <= 10) return 'tutorial';
  if (level <= 30) return 'normal';
  if (level <= 50) return 'hard';
  if (level <= 70) return 'expert';
  if (level <= 90) return 'master';
  return 'legendary';
}

// Enemy stat scaling by difficulty. Multipliers.
export interface DifficultyMods {
  hp: number;
  speed: number;
  fireRate: number;
  bulletSpeed: number;
  spawnDensity: number;
  rewardMul: number;
}

export function modsFor(level: number): DifficultyMods {
  const d = difficultyFor(level);
  return {
    hp: 1 + d * 3.5,
    speed: 0.9 + d * 1.1,
    // Bumped base from 0.8 → 1.3 so even tutorial-tier grunts (spec.fireRate
    // 0.5) shoot at ~0.65 rps from the get-go. The previous 0.4 rps meant
    // entire opening waves on L1-3 passed with almost no enemy bullets on
    // screen, which read as "the game is too easy".
    fireRate: 1.3 + d * 1.6,
    bulletSpeed: 0.9 + d * 0.8,
    spawnDensity: 1 + d * 1.4,
    rewardMul: 1 + d * 4,
  };
}

// $SKR base reward for level, halving across emission years.
// Year 0 reference. Engine reads halving from chain.
export function skrRewardForLevel(level: number): number {
  // Linear ramp 5 -> 80 across 1..100.
  return Math.round(5 + (75 * (level - 1)) / 99);
}

// ---- Deterministic difficulty schedule ----
// Galaxian-style: each level opens with a large swarm (the "first wave"), then
// follow-up waves attack as the swarm thins. Wave count steps up every 20 levels.
//
//   L1   → 50 enemies, 2 waves   (swarm 35 + follow-up 15)
//   L20  → 78 enemies, 2 waves
//   L21  → 78 enemies, 3 waves
//   L40  → 113 enemies, 3 waves
//   L41  → 114 enemies, 4 waves
//   L99  → 234 enemies, 6 waves
//   L100 → boss (intro + Sovereign)
//
// Boss levels (every 10th) keep their short intro + boss schedule.
export function targetEnemiesForLevel(level: number): number {
  if (level % 10 === 0) return BOSS_INTRO_ENEMIES;
  const x = level - 1;
  // -10 % vs. the old base+slope (user feedback: too dense on mobile).
  // Multiplier preserves the original growth shape:
  // L1 ≈ 59, L20 ≈ 87, L40 ≈ 125, L100 ≈ 280 (was 65/97/139/311).
  return Math.round((65 + 1.5 * x + 0.01 * x * x) * 0.9);
}

// Boss-intro wave also scaled down by 10 % so the LV10/20/… opener feels
// in line with the rest of the curve.
export const BOSS_INTRO_ENEMIES = 11;

//   L1-29   → 1   (single swarm — no end-of-level trickle)
//   L30-59  → 2
//   L60-89  → 3
//   L90-100 → 4
export function wavesForLevel(level: number): number {
  if (level % 10 === 0) return 1;            // boss-intro wave only
  return Math.min(4, 1 + Math.floor(level / 30));
}

// Budget split per wave. The first wave is intentionally the *swarm* — most of
// the enemies arrive at once and the level pressure decays from there.
// Returned weights are normalised by the caller; relative magnitudes matter.
export function waveWeights(numWaves: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < numWaves; i++) {
    // First wave is the dominant swarm; later waves shrink hyperbolically.
    w.push(i === 0 ? 1.8 : 1 / (1 + i * 0.55));
  }
  return w;
}

