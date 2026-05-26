// ── Backend API helpers ─────────────────────────────────────────────
//
// The backend is a thin score-verifier + leaderboard + missions ledger.
// It does NOT custody funds or mint tokens. SKR transfers go directly
// from the player's wallet to the treasury wallet via an SPL transfer
// (see `skr.ts`).

import { NETWORKS, type NetworkName } from './config';
import { walletAddress, currentNetwork } from './wallet';
import type { RunResult } from '../game/types';

function net(): NetworkName { return currentNetwork() as NetworkName; }
function cfg() { return NETWORKS[net()]; }

/**
 * Backend-acknowledged claim payload. The "signature" field is a base58
 * receipt the backend issues so the client can prove its score was
 * accepted; it is NOT used for any on-chain action, just for the UI
 * "you cleared LV X" toast and for the leaderboard merge.
 */
export interface SignedScore {
  player: string;
  levelId: number;
  score: number;
  amount: string;          // PTS amount awarded
  nonce: number;
  expiry: number;
  signature: string;       // base58, opaque to the client
}

export async function postRunToBackend(run: RunResult): Promise<SignedScore> {
  const r = await fetch(`${cfg().backendUrl}/api/run/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(run),
  });
  if (!r.ok) throw new Error(`Backend rejected score: ${await r.text()}`);
  return (await r.json()) as SignedScore;
}

/// Credit lifetime POINTS for a connected wallet (after a shop purchase).
export async function creditPoints(amount: number): Promise<void> {
  const a = walletAddress();
  if (!a || !Number.isFinite(amount) || amount <= 0) return;
  try {
    await fetch(`${cfg().backendUrl}/api/points/credit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player: a, amount: Math.floor(amount) }),
    });
  } catch (e) { console.warn('[points] credit failed', e); }
}

export async function fetchLeaderboard(levelId?: number) {
  const url = `${cfg().backendUrl}/api/leaderboard${levelId ? `?level=${levelId}` : ''}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  return r.json();
}

/**
 * "Claim rewards" — purely off-chain. Marks the run as ack'd in the
 * backend ledger and returns the receipt id. There is no on-chain SKR
 * payout: SKR is earned by *spending* (50 SKR for a ship transfers SKR
 * to the treasury), not by playing — same as buying tokens to play any
 * game. POINTS are the in-game reward currency.
 */
export async function claimRewards(signed: SignedScore): Promise<string> {
  return signed.signature;
}

/// Highest level the player has cleared (server keeps this aggregate).
export async function getHighestLevel(): Promise<number> {
  const a = walletAddress();
  if (!a) return 0;
  try {
    const r = await fetch(`${cfg().backendUrl}/api/player/${a}`);
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j?.highestLevel ?? 0);
  } catch { return 0; }
}
