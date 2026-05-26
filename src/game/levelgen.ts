// Deterministic level generator.
//
// Each non-boss level has an explicit total enemy budget (see `targetEnemiesForLevel`).
// We split the budget across `wavesForLevel(level)` waves, pick a visual pattern per wave,
// and let the pattern lay out exactly `wave.budget` enemies. This makes the difficulty
// curve monotonic and reproducible — L23 always spawns the same number of enemies, in
// the same shapes, no matter the seed.

import type { LevelSpec, WaveSpec, EnemyPlacement, EnemyKind } from './types';
import { RNG, mixSeed, hashString } from './rng';
import { availableEnemiesAtLevel, BOSSES_ORDERED } from './enemies';
import {
  difficultyFor, tierFor, skrRewardForLevel,
  targetEnemiesForLevel, wavesForLevel, waveWeights, BOSS_INTRO_ENEMIES,
} from './difficulty';

const GAME_W = 480;
const FIELD_W = 460;
const COLS = 8;

export function generateLevel(level: number): LevelSpec {
  if (level < 1 || level > 100) throw new Error(`Level ${level} out of range`);
  const seedSalt = mixSeed(hashString('cosmic-seeker.level'), level);
  const rng = new RNG(seedSalt);
  const isBoss = level % 10 === 0;
  const tier = tierFor(level);
  const difficulty = difficultyFor(level);
  const palette = Math.min(6, Math.floor(level / 17));

  let waves: WaveSpec[];
  if (isBoss) {
    waves = generateBossLevel(level, rng);
  } else {
    waves = generateStandardLevel(level, rng);
  }

  return {
    id: level,
    tier,
    waves,
    background: palette,
    music: pickMusic(tier, rng),
    rewardStrk: skrRewardForLevel(level),
    isBoss,
    boss: isBoss ? BOSSES_ORDERED[(level / 10 | 0) - 1] : undefined,
    difficulty,
    seedSalt,
  };
}

function generateStandardLevel(level: number, rng: RNG): WaveSpec[] {
  const total = targetEnemiesForLevel(level);
  const numWaves = wavesForLevel(level);

  // Front-loaded budget — first wave is the swarm, later waves are smaller.
  const budgets = splitBudget(total, numWaves);

  // Wave 1 starts almost immediately so the screen fills up fast.
  // Subsequent waves come faster as level grows (more pressure).
  // `followGap` halved so the level doesn't end with the player waiting
  // 4 s for a trickle of stragglers. See basestriker levelgen for notes.
  let cursor = 200;
  const followGap = Math.max(1200, 2400 - level * 15);

  // Available patterns grow with level (variety unlocks).
  const patternPool = pickPatternPool(level);

  const waves: WaveSpec[] = [];
  for (let w = 0; w < numWaves; w++) {
    // Wave 0 (swarm) always uses a big-area pattern (grid/columns/diamond);
    // later waves can use any unlocked pattern for variety.
    const pool = w === 0 ? swarmPatterns(level) : patternPool;
    const pattern = pool[rng.int(0, pool.length - 1)];
    const enemies = layoutPattern(pattern, availableEnemiesAtLevel(level), rng, level, budgets[w]);
    waves.push({ delayMs: cursor, enemies });
    cursor += followGap + rng.int(-300, 400);
  }
  return waves;
}

function splitBudget(total: number, n: number): number[] {
  const weights = waveWeights(n);
  const sumW = weights.reduce((a, b) => a + b, 0);
  let remaining = total;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const share = isLast ? remaining : Math.max(3, Math.round((weights[i] / sumW) * total));
    out.push(Math.min(share, remaining));
    remaining -= out[i];
    if (remaining < 0) remaining = 0;
  }
  return out;
}

/// Big-area patterns suitable for the opening swarm wave.
function swarmPatterns(level: number): Pattern[] {
  const pool: Pattern[] = ['grid', 'columns'];
  if (level >= 8) pool.push('diamond');
  if (level >= 25) pool.push('cluster');
  return pool;
}

type Pattern = 'grid' | 'v' | 'diamond' | 'columns' | 'arc' | 'cross' | 'snake' | 'cluster';

function pickPatternPool(level: number): Pattern[] {
  const pool: Pattern[] = ['grid', 'columns'];
  if (level >= 3)  pool.push('v');
  if (level >= 8)  pool.push('diamond');
  if (level >= 15) pool.push('arc');
  if (level >= 25) pool.push('cross');
  if (level >= 35) pool.push('snake');
  if (level >= 45) pool.push('cluster');
  return pool;
}

/// Place exactly `budget` enemies using the given visual pattern.
function layoutPattern(
  pattern: Pattern,
  available: EnemyKind[],
  rng: RNG,
  level: number,
  budget: number,
): EnemyPlacement[] {
  const out: EnemyPlacement[] = [];
  if (budget <= 0) return out;
  const baseKinds = available.filter((k) => k !== 'voidling');
  const pickKind = (): EnemyKind => {
    const advancedBias = Math.min(0.8, level / 100);
    if (rng.chance(advancedBias) && baseKinds.length > 3) {
      return baseKinds[rng.int(Math.floor(baseKinds.length * 0.4), baseKinds.length - 1)];
    }
    return rng.pick(baseKinds);
  };

  switch (pattern) {
    case 'grid': {
      // Always fill the screen width — 8 columns. Vary rows by budget.
      const cols = COLS;
      const rows = Math.ceil(budget / cols);
      const spacingX = FIELD_W / (cols + 1);
      // Tighter vertical spacing when there are many rows so they fit visually.
      const rowGap = rows > 6 ? 22 : 26;
      let placed = 0;
      outer: for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed >= budget) break outer;
          out.push({
            kind: pickKind(),
            x: spacingX * (c + 1) + 10,
            y: -40 - r * rowGap,
            formationGroup: 1,
          });
          placed++;
        }
      }
      break;
    }

    case 'columns': {
      const cols = COLS;
      const rows = Math.ceil(budget / cols);
      const spacingX = FIELD_W / (cols + 1);
      const rowGap = rows > 6 ? 22 : 26;
      let placed = 0;
      outerC: for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (placed >= budget) break outerC;
          out.push({
            kind: pickKind(),
            x: spacingX * (c + 1) + 10,
            y: -40 - r * rowGap,
            formationGroup: 1,
          });
          placed++;
        }
      }
      break;
    }

    case 'v': {
      // Pairs around the centerline.
      const pairs = Math.ceil(budget / 2);
      for (let i = 0; i < pairs && out.length < budget; i++) {
        const off = 18 + i * 30;
        out.push({ kind: pickKind(), x: GAME_W / 2 - off, y: -40 - i * 24, formationGroup: 1 });
        if (out.length < budget) {
          out.push({ kind: pickKind(), x: GAME_W / 2 + off, y: -40 - i * 24, formationGroup: 1 });
        }
      }
      break;
    }

    case 'diamond': {
      // Diamond shell — rings out from a center.
      let i = 0;
      const rings: Array<[number, number]> = [];
      rings.push([0, 0]); // center
      while (rings.length < budget && i < 6) {
        i++;
        const ringR = i * 24;
        for (let a = 0; a < 4; a++) {
          const ang = a * (Math.PI / 2);
          rings.push([Math.cos(ang) * ringR, Math.sin(ang) * ringR * 0.6]);
          if (a < 3) rings.push([Math.cos(ang + Math.PI / 4) * ringR, Math.sin(ang + Math.PI / 4) * ringR * 0.6]);
          if (rings.length >= budget) break;
        }
      }
      for (let j = 0; j < Math.min(budget, rings.length); j++) {
        const [dx, dy] = rings[j];
        out.push({ kind: pickKind(), x: GAME_W / 2 + dx, y: -60 + dy, formationGroup: 1 });
      }
      break;
    }

    case 'arc': {
      const center = GAME_W / 2;
      const radius = 140 + Math.min(40, budget * 2);
      const count = budget;
      for (let i = 0; i < count; i++) {
        const a = Math.PI + (i / Math.max(1, count - 1)) * Math.PI;
        out.push({
          kind: pickKind(),
          x: center + Math.cos(a) * radius,
          y: -60 - Math.sin(a) * 60,
          formationGroup: 1,
        });
      }
      break;
    }

    case 'cross': {
      // Plus-shape: horizontal arm + vertical arm centered.
      const arm = Math.ceil(budget / 4);
      const placed: Array<[number, number]> = [];
      for (let i = -arm; i <= arm; i++) {
        placed.push([GAME_W / 2 + i * 30, -60]);                       // horizontal
        if (i !== 0) placed.push([GAME_W / 2, -60 - Math.abs(i) * 26]); // vertical
      }
      for (let j = 0; j < Math.min(budget, placed.length); j++) {
        const [x, y] = placed[j];
        out.push({ kind: pickKind(), x, y, formationGroup: 1 });
      }
      break;
    }

    case 'snake': {
      // S-curve descending. No per-enemy delayMs — batch spawn; the
      // staggered Y already gives the visual "trail" effect.
      for (let i = 0; i < budget; i++) {
        const x = GAME_W / 2 + Math.sin(i * 0.55) * 160;
        out.push({
          kind: pickKind(),
          x,
          y: -40 - i * 22,
          formationGroup: 1,
        });
      }
      break;
    }

    case 'cluster': {
      // 3 tight clusters, divide the budget roughly evenly.
      const groups = 3;
      const per = Math.ceil(budget / groups);
      let placed = 0;
      for (let g = 0; g < groups && placed < budget; g++) {
        const cx = 90 + g * 150 + rng.int(-15, 15);
        for (let i = 0; i < per && placed < budget; i++) {
          out.push({
            kind: pickKind(),
            x: cx + rng.int(-18, 18),
            y: -40 + rng.int(-30, 30),
            formationGroup: g + 1,
          });
          placed++;
        }
      }
      break;
    }
  }
  return out;
}

function generateBossLevel(level: number, rng: RNG): WaveSpec[] {
  // A short intro wave before the boss spawns. Always BOSS_INTRO_ENEMIES enemies.
  const introKinds = ['grunt', 'drone', 'scout'] as const;
  const intro: EnemyPlacement[] = [];
  const cols = 4;
  const spacingX = FIELD_W / (cols + 1);
  for (let i = 0; i < BOSS_INTRO_ENEMIES; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    intro.push({
      kind: rng.pick(introKinds) as EnemyKind,
      x: spacingX * (c + 1) + 10,
      y: -40 - r * 28,
      formationGroup: 1,
    });
  }
  return [{ delayMs: 600, enemies: intro }];
}

function pickMusic(tier: LevelSpec['tier'], rng: RNG): string {
  const tracks: Record<LevelSpec['tier'], string[]> = {
    tutorial: ['neon-dawn', 'crystal-drift'],
    normal: ['voltage', 'parallax', 'comet'],
    hard: ['fracture', 'overcharge', 'flux'],
    expert: ['singularity', 'event-horizon'],
    master: ['void-protocol', 'eclipse'],
    legendary: ['sovereign-ascend'],
  };
  return rng.pick(tracks[tier]);
}

export function generateAllLevels(): LevelSpec[] {
  return Array.from({ length: 100 }, (_, i) => generateLevel(i + 1));
}
