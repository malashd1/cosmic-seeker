// ── Lifetime POINTS ledger ──────────────────────────────────────────
// Distinct from in-run `player.score`. Points never reset; they accumulate
// from level clears and shop purchases. Cosmic Seeker uses the $SKR token
// as the unit of exchange; the conversion is 30 PTS per 1 SKR
// (equivalent to 300 PTS / $1 at the launch peg of 1 SKR = $0.10).
// Stored in localStorage for the dev/playtest build; production will mirror
// onto the backend so they survive across devices once a Seeker wallet is connected.

const KEY = 'cosmic-seeker.points';

export function getPoints(): number {
  try {
    const v = Number(localStorage.getItem(KEY) ?? '0');
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  } catch { return 0; }
}

export function addPoints(delta: number): number {
  if (!Number.isFinite(delta) || delta <= 0) return getPoints();
  const next = getPoints() + Math.floor(delta);
  try { localStorage.setItem(KEY, String(next)); } catch { /* private mode */ }
  notify(next);
  return next;
}

/// POINTS-per-SKR exchange rate for shop purchases.
export const POINTS_PER_SKR = 30;
/// Back-compat helpers (USD path used by legacy fiat code paths).
export const POINTS_PER_USD = 300;

export function pointsForSkr(skr: number): number {
  return Math.max(0, Math.floor(skr * POINTS_PER_SKR));
}
export function pointsForUsd(usd: number): number {
  return Math.max(0, Math.floor(usd * POINTS_PER_USD));
}

// ── Live update subscription (HUD listens) ──────────────────────────
type Listener = (total: number) => void;
const listeners = new Set<Listener>();
function notify(total: number) { for (const fn of listeners) fn(total); }

export function onPointsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
