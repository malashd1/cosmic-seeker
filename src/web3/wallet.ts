// Solana wallet bridge — Wallet Standard (the only thing that works
// reliably in TWA / Chrome custom tabs).
//
// MWA is registered at app boot in `main.ts` via `registerMwa(...)`. After
// that, the MWA wallet appears in `getWallets().get()` alongside any
// browser-injected wallets (Phantom extension, Solflare). We discover the
// best wallet, call its `standard:connect` to get an account, and hand the
// resulting `Wallet + WalletAccount` to `solana.ts` for signing.

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';

type SolanaAddress = string;

export type WalletKind = 'standard';   // legacy enum kept for old call sites
export type ConnectedWalletKind = WalletKind;

let _address: SolanaAddress | null = null;
let _wallet: Wallet | null = null;
let _account: WalletAccount | null = null;
const listeners = new Set<(addr: SolanaAddress | null) => void>();

export function walletAddress(): SolanaAddress | null { return _address; }
export function connectedWalletKind(): ConnectedWalletKind | null { return _address ? 'standard' : null; }
export function injectedProvider(): any { return null; }   // legacy stub
export function walletClient(): null { return null; }
export function publicClient(): null { return null; }
export function currentNetwork(): 'mainnet' { return 'mainnet'; }
export function setNetwork(_: string): void {}

/** The connected Wallet Standard wallet — `solana.ts` needs it for signing. */
export function connectedWallet(): Wallet | null { return _wallet; }
export function connectedAccount(): WalletAccount | null { return _account; }

export function onAddressChange(fn: (addr: SolanaAddress | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { for (const fn of listeners) fn(_address); }

// ── Wallet discovery ────────────────────────────────────────────────────

/**
 * Find the best Solana wallet currently registered with the Wallet Standard.
 * Priority:
 *   1. Mobile Wallet Adapter (registered by `registerMwa` in main.ts) —
 *      this is what works in TWA / Chrome custom tabs on Android.
 *   2. Any other wallet that advertises a `solana:` chain (Phantom extension
 *      on desktop, Backpack, Solflare).
 *
 * Returns null if no Solana wallet is registered (cold desktop, no extension).
 */
function pickSolanaWallet(): Wallet | null {
  const wallets = getWallets().get();
  const mwa = wallets.find((w) => w.name === 'Mobile Wallet Adapter');
  if (mwa) return mwa;
  return wallets.find((w) => w.chains.some((c) => c.startsWith('solana:'))) ?? null;
}

async function publicKeyToBase58(raw: Uint8Array): Promise<string> {
  const { PublicKey } = await import('@solana/web3.js');
  return new PublicKey(raw).toBase58();
}

// ── Connect / disconnect ───────────────────────────────────────────────

export async function connect(): Promise<SolanaAddress | null> {
  const w = pickSolanaWallet();
  if (!w) {
    alert('No Solana wallet detected. Install Phantom (mobile/desktop), Backpack, or use Seed Vault on a Seeker phone.');
    return null;
  }
  const features = w.features as any;
  const connectFeature = features['standard:connect'];
  if (!connectFeature?.connect) {
    throw new Error(`Wallet "${w.name}" does not implement standard:connect`);
  }
  const result = await connectFeature.connect();
  const acct = result?.accounts?.[0];
  if (!acct) return null;
  _wallet = w;
  _account = acct;
  _address = await publicKeyToBase58(acct.publicKey);
  persistSession({ address: _address, kind: 'standard' });
  emit();
  return _address;
}

export async function disconnect() {
  try {
    const features = _wallet?.features as any;
    await features?.['standard:disconnect']?.disconnect?.();
  } catch { /* */ }
  _address = null;
  _wallet = null;
  _account = null;
  persistSession(null);
  emit();
}

// ── Session persistence ────────────────────────────────────────────────

const STORAGE_KEY = 'cosmic-seeker.wallet';
interface PersistedSession { address: string; kind: WalletKind; ts: number; }

function persistSession(s: { address: string; kind: WalletKind } | null) {
  try {
    if (!s) { localStorage.removeItem(STORAGE_KEY); return; }
    const blob: PersistedSession = { ...s, ts: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch { /* */ }
}

function readSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as PersistedSession;
    if (!blob.address) return null;
    if (Date.now() - (blob.ts ?? 0) > 30 * 86_400_000) return null;
    return blob;
  } catch { return null; }
}

/**
 * Restore a saved session at app boot. We show the cached address
 * immediately so the HUD doesn't flicker through "disconnected", then
 * trigger a silent reconnect when a wallet feature exposes one
 * (`standard:connect` with `{silent:true}` is supported by some wallets;
 * MWA cached auth handles the rest on next signing call).
 */
export async function restoreSession(): Promise<SolanaAddress | null> {
  const cached = readSession();
  if (!cached) return null;
  _address = cached.address;
  emit();
  // Try to silently rebind the wallet so the next sign call doesn't
  // require a re-pick. We give wallet-standard a tick to finish
  // registering (registerMwa runs async in main.ts).
  setTimeout(() => { void silentReconnect(); }, 200);
  return _address;
}

async function silentReconnect() {
  const w = pickSolanaWallet();
  if (!w) return;
  const features = w.features as any;
  // Reuse cached MWA authorization if available — calling `standard:connect`
  // with `silent:true` returns without showing UI when the wallet has a
  // valid cached session.
  try {
    const r = await features['standard:connect']?.connect?.({ silent: true });
    const acct = r?.accounts?.[0];
    if (acct) {
      _wallet = w;
      _account = acct;
      _address = await publicKeyToBase58(acct.publicKey);
      persistSession({ address: _address, kind: 'standard' });
      emit();
    }
  } catch (e) {
    console.warn('[wallet] silent reconnect failed:', e);
  }
}
