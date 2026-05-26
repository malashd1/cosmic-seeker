// SKR balance probe for the HUD.
//
// One source of truth for "how much SKR does the connected wallet hold":
//
//   1. main.ts subscribes to `onSkrBalanceChange` once at boot.
//   2. The balance is refetched whenever:
//        - the connected wallet address changes
//        - `refreshSkrBalance()` is called (shop / claim flows hit this)
//        - a 30 s periodic timer fires (background settlements)
//
// All emissions go through `_emit` so subscribers (the HUD span) re-render
// without polling.

import { PublicKey } from '@solana/web3.js';
import { NETWORKS, DEFAULT_NETWORK, hasOnChainShop } from './config';
import { getConnection, walletPubkey } from './solana';
import { currentNetwork, onAddressChange, walletAddress } from './wallet';

export type SkrBalanceState =
  | { kind: 'no-wallet' }
  | { kind: 'no-config' }       // SKR mint not wired for this network
  | { kind: 'pending' }
  | { kind: 'value';  amount: number }   // human SKR (already divided by 10^decimals)
  | { kind: 'error';  message: string };

const listeners = new Set<(s: SkrBalanceState) => void>();
let _state: SkrBalanceState = { kind: 'no-wallet' };

export function getSkrBalanceState(): SkrBalanceState { return _state; }

export function onSkrBalanceChange(fn: (s: SkrBalanceState) => void): () => void {
  listeners.add(fn);
  fn(_state);
  return () => { listeners.delete(fn); };
}

function _set(s: SkrBalanceState) {
  _state = s;
  for (const fn of listeners) fn(s);
}

let _inflight = 0;

/**
 * Refetch the connected wallet's SKR balance (if any) and emit the result.
 * Idempotent: concurrent calls coalesce — only the most recent result wins.
 */
export async function refreshSkrBalance(): Promise<void> {
  if (!walletAddress() || !walletPubkey()) { _set({ kind: 'no-wallet' }); return; }

  const net = (currentNetwork() as keyof typeof NETWORKS) ?? DEFAULT_NETWORK;
  if (!hasOnChainShop(net)) { _set({ kind: 'no-config' }); return; }
  const cfg = NETWORKS[net] ?? NETWORKS[DEFAULT_NETWORK];

  const ticket = ++_inflight;
  _set({ kind: 'pending' });

  try {
    const owner = walletPubkey()!;
    const skrMint = new PublicKey(cfg.skrMint);
    const { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } =
      await import('@solana/spl-token');
    const ata = await getAssociatedTokenAddress(skrMint, owner);
    const conn = getConnection('confirmed');

    let raw = 0n;
    try {
      const acc = await getAccount(conn, ata);
      raw = acc.amount;
    } catch (e: any) {
      // No ATA yet → balance is genuinely zero, not an error.
      if (e instanceof TokenAccountNotFoundError) raw = 0n;
      else throw e;
    }
    if (ticket !== _inflight) return; // stale response — newer call already fired

    const scale = 10n ** BigInt(cfg.skrDecimals);
    // Keep two decimal digits of precision for the HUD without floating-point drift.
    const whole = raw / scale;
    const frac  = (raw % scale) * 100n / scale;
    const amount = Number(whole) + Number(frac) / 100;
    _set({ kind: 'value', amount });
  } catch (e: any) {
    if (ticket !== _inflight) return;
    _set({ kind: 'error', message: e?.message ?? 'fetch failed' });
  }
}

// ── Wiring ────────────────────────────────────────────────────────────

let _started = false;

/** Hook the balance into the wallet lifecycle. Idempotent. */
export function startSkrBalanceWatcher(opts: { intervalMs?: number } = {}): void {
  if (_started) return;
  _started = true;
  const intervalMs = Math.max(5_000, opts.intervalMs ?? 30_000);

  onAddressChange(() => { void refreshSkrBalance(); });
  // First load.
  void refreshSkrBalance();
  // Periodic refresh — catches background tournament settlements that don't
  // route through shop/claim hooks.
  setInterval(() => { void refreshSkrBalance(); }, intervalMs);
}

/** Format a balance state for the HUD chip. */
export function formatSkrBalance(s: SkrBalanceState): string {
  switch (s.kind) {
    case 'no-wallet':  return '';
    case 'no-config':  return '';
    case 'pending':    return 'SKR …';
    case 'error':      return 'SKR ?';
    case 'value':
      return `SKR ${s.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
}
