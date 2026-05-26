// Daily tournament — one shared seed per day, 7 levels in a fixed order, single life pool.
// Anyone playing today gets the same level sequence; weekly prize pool of $SKR split by rank.

import type { RunResult } from './shared/types.js';

const TOTAL_LEVELS = 100;
const TOURNAMENT_LEVELS = 7;

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TournamentSpec {
  id: string;          // e.g. "T-2026-05-14"
  epoch: number;       // daily epoch
  levels: number[];    // length TOURNAMENT_LEVELS, ascending difficulty
  prizePoolStrk: number;
  payoutCurve: number[]; // share fractions, sum = 1
}

export function todayTournament(epoch: number = Math.floor(Date.now() / 86_400_000)): TournamentSpec {
  const seed = fnv1a(`bsk:tournament:${epoch}`);
  const rng = mulberry32(seed);

  // Pick 7 levels in ascending difficulty:
  //   2 from 1..30, 2 from 31..60, 2 from 61..90, 1 from 91..100.
  const pickRange = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const levels = [
    pickRange(1, 15), pickRange(16, 30),
    pickRange(31, 45), pickRange(46, 60),
    pickRange(61, 75), pickRange(76, 90),
    pickRange(91, 100),
  ];
  // Ensure boss-level density: replace 1 random index with a boss level (multiple of 10) within its tier.
  const bossSlot = Math.floor(rng() * TOURNAMENT_LEVELS);
  levels[bossSlot] = Math.max(10, Math.min(100, Math.round(levels[bossSlot] / 10) * 10));

  // Payout curve: top 100 split, geometric.
  const payoutCurve = geometricCurve(100, 0.93);

  return {
    id: tournamentIdFromEpoch(epoch),
    epoch,
    levels,
    prizePoolStrk: 25_000,
    payoutCurve,
  };
}

export function tournamentIdFromEpoch(epoch: number): string {
  const d = new Date(epoch * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `T-${y}-${m}-${day}`;
}

function geometricCurve(n: number, ratio: number): number[] {
  const w: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const wi = Math.pow(ratio, i);
    w.push(wi); total += wi;
  }
  return w.map((x) => x / total);
}

export interface TournamentSubmission {
  player: string;
  tournamentId: string;
  perLevelScores: number[]; // length TOURNAMENT_LEVELS
  totalScore: number;
  totalDamageTaken: number;
  totalEnemiesKilled: number;
  runs: RunResult[];
}

export function validateSubmission(sub: TournamentSubmission, spec: TournamentSpec): string | null {
  if (!sub || sub.tournamentId !== spec.id) return 'wrong_tournament';
  if (!Array.isArray(sub.perLevelScores) || sub.perLevelScores.length !== TOURNAMENT_LEVELS) return 'bad_scores_length';
  if (!Array.isArray(sub.runs) || sub.runs.length !== TOURNAMENT_LEVELS) return 'bad_runs_length';
  for (let i = 0; i < TOURNAMENT_LEVELS; i++) {
    if (sub.runs[i].levelId !== spec.levels[i]) return `wrong_level_${i}`;
    if (sub.runs[i].score !== sub.perLevelScores[i]) return `score_mismatch_${i}`;
  }
  const sum = sub.perLevelScores.reduce((a, b) => a + b, 0);
  if (sub.totalScore !== sum) return 'totals_mismatch';
  return null;
}
