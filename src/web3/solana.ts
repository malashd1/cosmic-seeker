// Solana web3.js bridge — Wallet Standard edition.
//
// One uniform `signAndSendTx(ixs)` that delegates to whatever Wallet
// Standard wallet is currently connected (`wallet.ts` owns the discovery).
// Works in TWA / Chrome custom tabs on Android (via MWA, registered at
// boot in `main.ts`) and in desktop browsers (Phantom/Solflare extension).

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  type Commitment,
  type ConfirmOptions,
  type TransactionInstruction,
} from '@solana/web3.js';
import { NETWORKS, DEFAULT_NETWORK, type NetworkName } from './config';
import {
  walletAddress,
  connectedWallet,
  connectedAccount,
  currentNetwork,
} from './wallet';

// ── Connection singleton ───────────────────────────────────────────────

let _conn: Connection | null = null;
let _connRpc: string | null = null;

export function getConnection(commitment: Commitment = 'confirmed'): Connection {
  const net = (currentNetwork() as NetworkName) || DEFAULT_NETWORK;
  const rpc = NETWORKS[net]?.rpcUrl ?? NETWORKS[DEFAULT_NETWORK].rpcUrl;
  if (!_conn || _connRpc !== rpc) {
    _conn = new Connection(rpc, { commitment, confirmTransactionInitialTimeout: 90_000 });
    _connRpc = rpc;
  }
  return _conn;
}

export function resetConnection(): void {
  _conn = null;
  _connRpc = null;
}

export function walletPubkey(): PublicKey | null {
  const a = walletAddress();
  if (!a) return null;
  try { return new PublicKey(a); } catch { return null; }
}

// ── Sign + send via Wallet Standard ─────────────────────────────────────

/**
 * Sign + send a transaction through the currently-connected wallet.
 *
 * We build a v0 (`VersionedTransaction`) message — every modern Solana
 * wallet supports it and it's required by Phantom mobile. The wallet
 * sees the assembled blockhash + fee payer in its review sheet.
 */
export async function signAndSendTx(
  ixs: TransactionInstruction[],
  opts: ConfirmOptions = { commitment: 'confirmed' },
): Promise<string> {
  const conn = getConnection(opts.commitment ?? 'confirmed');

  // Wallet binding may be partially stale after a page reload: `walletAddress()`
  // is restored synchronously from localStorage (so the HUD shows "Connected"
  // straight away) but `connectedWallet()` / `connectedAccount()` only attach
  // once `silentReconnect()` finishes. Without auto-recovery, the shop's first
  // BUY tap throws "Wallet session lost — please reconnect." even though the
  // HUD still claims connected. Drive `connect()` here so MWA can hand back a
  // wallet handle (silently when its auth cache is still warm, or with the
  // standard prompt if not).
  const { connect } = await import('./wallet');
  let wallet = connectedWallet();
  let account = connectedAccount();
  if (!wallet || !account) {
    await connect();
    wallet = connectedWallet();
    account = connectedAccount();
  }

  const payer = walletPubkey();
  if (!payer) throw new Error('No wallet connected. Tap CONNECT WALLET first.');
  if (!wallet || !account) throw new Error('Wallet session lost — please reconnect.');

  // Build v0 tx.
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(opts.commitment ?? 'confirmed');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  // ── Wallet Standard: `solana:signAndSendTransaction` ──
  const features = wallet.features as any;
  const signAndSend = features['solana:signAndSendTransaction'];

  let signature: string | null = null;

  if (signAndSend?.signAndSendTransaction) {
    const serialized = tx.serialize();
    const [out] = await signAndSend.signAndSendTransaction({
      account,
      transaction: serialized,
      chain: 'solana:mainnet',
    });
    const bs58 = (await import('bs58')).default;
    signature = bs58.encode(out.signature);
  } else {
    // Fallback: `solana:signTransaction` + raw send via our RPC.
    const signTransaction = features['solana:signTransaction'];
    if (!signTransaction?.signTransaction) {
      throw new Error(`Wallet "${wallet.name}" implements neither signAndSendTransaction nor signTransaction.`);
    }
    const serialized = tx.serialize();
    const [signed] = await signTransaction.signTransaction({
      account,
      transaction: serialized,
      chain: 'solana:mainnet',
    });
    signature = await conn.sendRawTransaction(signed.signedTransaction, {
      skipPreflight: opts.skipPreflight ?? false,
      preflightCommitment: opts.preflightCommitment ?? 'confirmed',
    });
  }

  if (!signature) throw new Error('Wallet returned no signature.');
  // Fire-and-forget confirmation. The wallet has already broadcast the
  // tx on its own RPC by the time we get the signature — waiting for
  // OUR RPC to see it is what was causing the >1 min "CONFIRMING…"
  // delay (our proxy can lag the wallet's RPC by 30-90 s for newly
  // submitted txs). The shop credits the boost off our return value;
  // the in-flight confirmation runs in the background and logs to
  // console if something goes wrong.
  void confirmTx(conn, signature, opts, lastValidBlockHeight, blockhash)
    .catch((e) => console.warn('[solana] background confirmTx:', signature, e));
  return signature;
}

// ── Confirmation ──────────────────────────────────────────────────────

export async function confirmTx(
  conn: Connection,
  signature: string,
  opts: ConfirmOptions = { commitment: 'confirmed' },
  lastValidBlockHeight?: number,
  blockhash?: string,
): Promise<void> {
  if (lastValidBlockHeight !== undefined && blockhash) {
    await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      opts.commitment ?? 'confirmed',
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    await conn.confirmTransaction(signature, opts.commitment ?? 'confirmed');
  }
}

// ── Helpers used by shop / claim flows ─────────────────────────────────

// Legacy export — kept for any caller still importing this. Not used by
// the new flow (Transaction → VersionedTransaction migration above).
export { Transaction };

export async function getSkrAta(skrMint: PublicKey): Promise<PublicKey | null> {
  const owner = walletPubkey();
  if (!owner) return null;
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  return getAssociatedTokenAddress(skrMint, owner);
}
