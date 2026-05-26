// Daily missions — deterministic per (player, day) so the same wallet sees the same
// 3 missions for 24h, and the rewards distributor can sign claims for them.

import type { RunResult } from './shared/types.js';

export type MissionId =
  | 'kill_n_enemies'
  | 'clear_level'
  | 'score_threshold'
  | 'boss_kill';

export interface MissionTemplate {
  id: MissionId;
  title: string;
  description: (param: number) => string;
  paramRange: [number, number];
  rewardStrk: number; // base reward, halved with emission halving
}

export interface Mission {
  id: MissionId;
  param: number;
  title: string;
  description: string;
  rewardStrk: number;
  progress: number; // 0..param
  completed: boolean;
}

// Mission catalog.
//
// Score / kills are CUMULATIVE within a single run (`carriedScore` +
// `carriedKills` in Game.ts carry them across levels), so:
//   - "in one run" missions track the HIGHEST cumulative value the player
//     reaches in any single attempt that day (server uses MAX semantic).
//   - target ranges are sized for cumulative play through LV 1-10.
//
// Reward tier: prior 30-100 was way too generous; user later asked for
// ×3 from the over-corrected 4-12 → settled at 12-36 (about a third of
// the original numbers).
//
// Removed: `no_damage_clear` (flaky — single grunt bullet failed it,
// players reported it never registers) and `level_clear_streak` (was
// equivalent to `clear_level` after the cumulative-progress rewrite).
const TEMPLATES: MissionTemplate[] = [
  {
    id: 'kill_n_enemies',
    title: 'Striker',
    description: (n) => `Destroy ${n} enemies in one run`,
    // Range bumped to reflect cumulative within-run kills. LV 1 ≈ 50,
    // LV 5 cumulative ≈ 150, LV 10 cumulative ≈ 230. 50-200 covers the
    // newbie sweet spot.
    paramRange: [50, 200],
    rewardStrk: 12,
  },
  {
    id: 'clear_level',
    title: 'Sortie',
    description: (n) => `Clear level ${n} or higher`,
    paramRange: [1, 5],
    rewardStrk: 18,
  },
  {
    id: 'score_threshold',
    title: 'High Roller',
    // Cumulative score in a single run:
    //   LV 1 only:        ~600
    //   LV 1-3 cleared:   ~1 800
    //   LV 1-5 cleared:   ~3 500
    //   LV 1-10 (boss):   ~6 000-8 000
    // 1000-5000 targets levels 2-7 worth of cumulative play.
    description: (n) => `Reach ${n.toLocaleString()} score in one run`,
    paramRange: [1000, 5000],
    rewardStrk: 24,
  },
  {
    id: 'boss_kill',
    title: 'Boss Slayer',
    description: () => `Kill any boss today`,
    paramRange: [1, 1],
    rewardStrk: 36,
  },
];

// Deterministic small RNG (xmur3 + sfc32). Keeps output stable across server restarts.
function makeRng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function dailyMissions(player: string, epoch: number): Mission[] {
  const rng = makeRng(`${player.toLowerCase()}:${epoch}`);
  // 3 missions per day. With only 4 templates available a player will
  // see 3 of the 4 each day; the missing one rotates pseudo-randomly.
  const pool = TEMPLATES.slice();
  const picks: Mission[] = [];
  const want = Math.min(3, pool.length);
  for (let i = 0; i < want && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    const tpl = pool.splice(idx, 1)[0];
    const [lo, hi] = tpl.paramRange;
    const param = lo + Math.floor(rng() * (hi - lo + 1));
    picks.push({
      id: tpl.id,
      param,
      title: tpl.title,
      description: tpl.description(param),
      rewardStrk: tpl.rewardStrk,
      progress: 0,
      completed: false,
    });
  }
  return picks;
}

export interface MissionDelta {
  id: MissionId;
  /** Absolute new progress value (MAX semantic). Server upserts as MAX. */
  progressAbs: number;
  completed: boolean;
}

/// Evaluate which missions a run contributes to. Because `run.score` and
/// `run.enemiesKilled` are CUMULATIVE within a single run (the engine
/// carries them between levels), we return the absolute value to take
/// MAX against existing progress — never sum deltas, which would
/// double-count submits from earlier levels of the same run.
export function applyRunToMissions(run: RunResult, missions: Mission[]): MissionDelta[] {
  const deltas: MissionDelta[] = [];
  for (const m of missions) {
    if (m.completed) continue;
    let abs = 0;
    let nowComplete = false;
    switch (m.id) {
      case 'kill_n_enemies':
        abs = Math.max(0, run.enemiesKilled | 0);
        nowComplete = abs >= m.param;
        break;
      case 'clear_level':
        if (run.levelId >= m.param) { abs = m.param; nowComplete = true; }
        break;
      case 'score_threshold':
        abs = Math.max(0, run.score | 0);
        nowComplete = abs >= m.param;
        break;
      case 'boss_kill':
        if (run.bossKilled) { abs = 1; nowComplete = true; }
        break;
    }
    if (abs > m.progress || nowComplete) {
      deltas.push({ id: m.id, progressAbs: Math.min(m.param, abs), completed: nowComplete });
    }
  }
  return deltas;
}
