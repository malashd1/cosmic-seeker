// Shop SKR-transfer helper.
//
// Mirrors how classic_games handles its SOL donation: build the transaction,
// hand it to the wallet, let the wallet do its own simulation + error
// messaging. We deliberately do NOT pre-flight `getAccount` / `getMint`
// against the RPC here — those calls used to throw
// "failed to get info about account ..." when the public Solana RPC
// rate-limited or rejected browser-origin requests, and surfaced an
// unhelpful error BEFORE the wallet even popped up.
//
// What we do instead:
//   1. Derive buyer + treasury ATAs (pure math, no RPC).
//   2. Prepend an *idempotent* `createAssociatedTokenAccount` ix for each
//      side. Idempotent = creates the ATA if missing, no-op if it already
//      exists. No RPC check required, costs ~2 039 lamports rent if it
//      actually creates one.
//   3. Append `transferChecked`.
//   4. `signAndSendTx` builds the v0 / legacy tx, sets blockhash + fee
//      payer, and hands it to whichever wallet flavour is connected.
//
// If the buyer has no SKR, the wallet's own simulation will refuse the tx
// and show its own "insufficient funds" message — same UX as
// classic_games' SOL donation flow.

import {
  PublicKey,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  NETWORKS,
  DEFAULT_NETWORK,
  hasOnChainShop,
} from './config';
import {
  signAndSendTx,
  walletPubkey,
} from './solana';
import { currentNetwork, walletAddress } from './wallet';

export type BuyOutcome =
  | { kind: 'tx';        signature: string }
  | { kind: 'no-wallet' }
  | { kind: 'no-config' };

/**
 * Try to send `priceSkr × qty` SKR from the connected wallet to the treasury.
 *
 * `priceSkr` is in whole SKR units (the shop catalogue already uses these,
 * e.g. 5 / 10 / 45). We multiply by `10**decimals` to derive the base-unit
 * `u64` amount that SPL Token expects.
 */
export async function buyItemSkr(priceSkr: number, qty: number): Promise<BuyOutcome> {
  if (!walletAddress() || !walletPubkey()) return { kind: 'no-wallet' };
  const net = currentNetwork() as keyof typeof NETWORKS;
  if (!hasOnChainShop(net)) return { kind: 'no-config' };

  const cfg = NETWORKS[net] ?? NETWORKS[DEFAULT_NETWORK];
  const buyer    = walletPubkey()!;
  const skrMint  = new PublicKey(cfg.skrMint);
  const treasury = new PublicKey(cfg.treasury);

  const {
    getAssociatedTokenAddress,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountIdempotentInstruction,
  } = await import('@solana/spl-token');

  // Pure local PDA math — no network call.
  const buyerAta    = await getAssociatedTokenAddress(skrMint, buyer);
  const treasuryAta = await getAssociatedTokenAddress(skrMint, treasury, /* allowOwnerOffCurve */ true);

  // SPL `transferChecked` wants u64 base units. We go through `bigint` to
  // avoid silent precision loss on weird decimal values.
  const baseUnits = BigInt(priceSkr) * BigInt(qty) * (10n ** BigInt(cfg.skrDecimals));

  const ixs: TransactionInstruction[] = [
    // Idempotent ATA create — works whether or not the account already
    // exists, replaces the old `getAccount` → conditional-create pattern
    // that needed an RPC round-trip and broke on rate-limited endpoints.
    createAssociatedTokenAccountIdempotentInstruction(buyer,    buyerAta,    buyer,    skrMint),
    createAssociatedTokenAccountIdempotentInstruction(buyer,    treasuryAta, treasury, skrMint),
    createTransferCheckedInstruction(
      buyerAta,
      skrMint,
      treasuryAta,
      buyer,
      baseUnits,
      cfg.skrDecimals,
    ),
  ];

  const signature = await signAndSendTx(ixs, { commitment: 'confirmed' });
  return { kind: 'tx', signature };
}
