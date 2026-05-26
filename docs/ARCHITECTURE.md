# Architecture

## System diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                   Player device — Capacitor WebView                  │
│                                                                      │
│  ┌────────────────┐   ┌───────────────────────┐   ┌──────────────┐   │
│  │  Game (TS)     │   │  Wallet bridge        │   │  Shop / UI   │   │
│  │  Canvas 480×960│   │  MWA (Seeker)         │   │  Settings    │   │
│  │  60 Hz fixed   │   │  → Phantom fallback   │   │  Missions    │   │
│  └────────┬───────┘   │  → SKR balance probe  │   └─────┬────────┘   │
│           │           └───────────┬───────────┘         │            │
└───────────┼───────────────────────┼─────────────────────┼────────────┘
            │                       │                     │
            │ POST /api/run/verify  │ MWA / injected      │ HTTP
            │ POST /api/points/...  │ signAndSendTx       │ /api/leaderboard
            ▼                       ▼                     ▼
┌────────────────────────────────────┐    ┌─────────────────────────────┐
│   Backend (Node 20 + Express)      │    │     Solana mainnet-beta     │
│                                    │    │   (api.mainnet-beta.       │
│  • Validates RunResult             │    │     solana.com)             │
│  • Replays run from (seed, inputs) │    │                             │
│  • Builds canonical claim msg      │    │  SPL $SKR mint              │
│  • ed25519-signs SHA-256(msg)      │    │   (decimals 6, supply 100M) │
│  • Records nonces + missions       │    │                             │
│  • Stripe webhook → pending_mints  │    │  CosmicSeeker Anchor program│
│  • SQLite (cosmic-seeker.db)       │    │   • initialize  (one-shot)  │
│                                    │    │   • claim_reward            │
│  Behind Caddy + Let's Encrypt at   │    │   • buy_item                │
│  cosmic.soulview.org               │    │                             │
└────────────┬───────────────────────┘    │  Treasury vault (PDA-owned  │
             │                            │   ATA of $SKR)              │
             │ Off-chain ledger only:     │                             │
             │   - score replay results   │  Indexer (Helius webhook)   │
             │   - mission progress       │   ← BuyItemEvent +          │
             │   - inventory mirror       │     ClaimRewardEvent         │
             │   - pending_mints queue    │                             │
             │                            └────────────┬────────────────┘
             │                                         │
             └────────── public RPC (read-only) ───────┘
```

## Trust model

| Component | What it trusts | What trusts it |
|---|---|---|
| Game (client) | Nothing | Nothing — client is untrusted by design |
| Backend signer (ed25519) | Deterministic replay of (seed, inputs) | Anchor `claim_reward` (cross-checks against `Config.signer_pubkey`) |
| Anchor program | The native `Ed25519Program::verify` ix in the leading slot, the registered `Config.signer_pubkey`, on-chain SHA-256 over the rebuilt canonical message | Players (they receive SKR) |
| Treasury vault | The Config PDA as its `authority` | Rewards pool (funded from treasury) |
| Mint (SPL) | Whatever wallet owns its `mint_authority` | Everyone — once authority is revoked, supply is irreversibly fixed |

The single trust apex is the **backend ed25519 signer key**. Compromise of
that key drains the rewards pool up to `daily_cap × distinct wallets`
before either (a) the operator rotates the signer pubkey via a future
`set_signer` admin ix, or (b) `SIGNER_KEYPAIR_BASE58` is rotated and old
signatures stop verifying. Mitigations:

- **Daily wallet cap** (20 SKR / wallet / day in year 1) — enforced both
  in the backend `/api/run/verify` and on-chain via a per-`(claimer,
  daily_epoch)` PDA, so a stolen signer can't flood a single wallet
  unbounded.
- **Per-`(claimer, nonce)` PDA** replay-protect — even with the stolen
  signer, every claim consumes a unique nonce slot.
- **Signer key in production lives in a Cloud KMS / Vault**, not the
  Docker `.env`. The local dev key (deterministic seed `[0x42; 32]`) is
  rejected at production boot.
- **`Config.signer_pubkey` rotation** ships as a planned admin
  instruction; until then, rotation requires program redeploy.

## Determinism (replay)

Run seed: `seed = SHA-256(player_pubkey || level_id || daily_epoch)`.
The same seed + the same input frame stream produces the same game
state and score on any machine. Backend has the engine bundled, runs
`runHeadless(seed, inputs)`, and compares the returned score to the
claimed one. Tolerance is ±0 because the engine is integer-stepped.

The backend's verifier currently runs only the sanity layer; the full
replay verifier is a build-time goal (sharing the engine via `npm
workspaces`).

## Claim signature scheme

The byte layout the backend signs, the Anchor program verifies, and the
test helpers reconstruct **must stay in lock-step across all three**:

```
[u8 player_len]                    ← length of the UTF-8 player string
[player_utf8]                      ← base58 Solana pubkey, ~44 bytes
[u16 BE  level_id]
[u64 BE  score]
[u128 BE amount]                   ← SKR in base units (decimals 6)
[u64 BE  nonce]
[u64 BE  expiry]                   ← unix seconds
```

Backend computes `digest = SHA-256(message)`, signs with
`nacl.sign.detached(digest, signerSecretKey)`, returns the 64-byte
signature as base58.

The client transaction the wallet signs:

```
ix[0] = Ed25519Program::verify {
          num_signatures: 1,
          pubkey:    <backend signer pubkey>,
          message:   <32-byte SHA-256 digest>,
          signature: <64-byte backend ed25519 sig>,
        }
ix[1] = cosmic_seeker::claim_reward(level_id, score, amount, nonce, expiry)
```

The Anchor program's `claim_reward` loads `ix[0]` from the instructions
sysvar, asserts:

1. `ix[0].program_id == ed25519_program::ID`.
2. The embedded pubkey equals `Config.signer_pubkey`.
3. The embedded message equals `sha256(canonical_msg_rebuilt_on_chain)`.

Then transfers `amount` SKR from `treasury_vault` (Config-PDA-signed
CPI) to the player's SKR ATA. Replay-protect closes the loop via the
per-`(claimer, nonce)` PDA.

## Why this layering

- **Score logic on backend, not on chain.** Putting per-frame replay
  on chain is prohibitive (compute units + state). ed25519-signed
  attestation is the standard pattern; Solana's native Ed25519 program
  makes verification a single syscall.
- **Game determinism for free anti-cheat.** Players cannot fake a high
  score because the same inputs produce the same score on the server.
- **Daily caps on chain, not just off chain.** Off-chain caps can be
  bypassed by rotating IPs; on-chain caps cannot (the program holds
  authoritative per-`(claimer, daily_epoch)` state).
- **Burns happen on chain.** Every shop sink burns via `token::burn` in
  the `buy_item` instruction, visible on Solana Explorer + indexed via
  the Helius webhook stream.
- **Inventory is off-chain (v1).** Per-item NFTs would multiply mint
  costs and complicate UX. The `BuyItemEvent` log is the source of
  truth; the backend SQLite mirror is a cache. v2 adds Metaplex
  Token-2022 / Compressed NFT cosmetics, see `WHITEPAPER.md` § 3.6.

## Wallet UX

When the player is on a **Seeker phone with Seed Vault**:
- One-tap connect via Mobile Wallet Adapter. No seed phrase.
- Signing every claim/buy is a single MWA round-trip; fees ~$0.0005.
- The wallet adapter session embeds a device attestation, making
  Sybil farming hardware-bound (cost floor ~$450 per account).

When the player is on **desktop with Phantom / Solflare**:
- Standard injected `window.solana` flow.
- We dispatch on `signAndSendTransaction` (Phantom-preferred) and fall
  back to `signTransaction` + `Connection.sendRawTransaction`.

When the player has **no wallet**:
- Settings, shop, leaderboard render normally.
- BUY buttons read `CONNECT WALLET TO BUY` and trigger the wallet
  picker on tap. Inventory mutations are gated behind a connected
  wallet — the off-chain credit path only runs after the wallet
  resolves (or, on devnet, when SKR mint/treasury env vars are unset
  and the on-chain path is skipped).

## File map (key entry points)

| Path | Purpose |
|---|---|
| `src/main.ts` | App boot — wires UI, game, wallet, SKR balance watcher |
| `src/game/Game.ts` | Fixed-step engine, collision, scoring |
| `src/game/levelgen.ts` | Deterministic level generator |
| `src/game/enemies.ts` | 12 enemy specs, 10 boss specs |
| `src/game/boss.ts` | Boss state machines |
| `src/web3/wallet.ts` | MWA + injected wallet discovery, `connect()` UI |
| `src/web3/solana.ts` | `Connection` singleton + `signAndSendTx` dispatcher |
| `src/web3/skr.ts` | Shop SPL transfer (`buyItemSkr`) |
| `src/web3/claim.ts` | Anchor `claim_reward` ix builder + Ed25519 verify ix |
| `src/web3/balance.ts` | Live SKR balance subscription for the HUD |
| `src/web3/api.ts` | Backend REST helpers, `SignedScore` type |
| `src/web3/config.ts` | Per-network knobs (`skrMint`, `treasury`, `programId`) |
| `src/ui/shop.ts` | Shop panel, async BUY flow with on-chain tx |
| `src/ui/settings.ts` | Settings panel: SFX, ship/weapon catalogue, legal |
| `src/ui/legal.ts` | Privacy, Terms, Disclaimer, About modals |
| `backend/src/server.ts` | Express routes, ed25519 `signClaim` |
| `backend/src/env.ts` | Env loader, `SIGNER_KEYPAIR_BASE58` validation |
| `backend/src/verify.ts` | Run sanity verification |
| `backend/src/stripe.ts` | Fiat onramp → `pending_mints` queue |
| `program/programs/cosmic-seeker/src/lib.rs` | Anchor program — `initialize` / `claim_reward` / `buy_item` |
| `program/tests/cosmic-seeker.ts` | Anchor integration tests (mocha) |
| `legacy-evm/src/*.sol` | Archived Solidity — audit reference only |

## Process / data lifecycle

| Event | Backend writes | On-chain writes |
|---|---|---|
| Player loads game | — | — |
| Level cleared | `runs(player, level, score, accepted=1)` | — |
| `claimRewards(signed)` | mark `nonces(nonce, player)` issued | `claim_reward` ix — `nonce_record` PDA init + SKR transfer |
| Shop BUY | `points_total += pts` | `buy_item` ix — `token::transfer` + `token::burn` + `BuyItemEvent` |
| Stripe checkout completed | `pending_mints` row queued | (deferred — Anchor relayer worker, TBD) |
| Daily-mission claim | `mission_progress.claimed = 1` | `claim_reward` ix if mission rewards SKR |
| Tournament settlement | `tournament_runs` keep-best | weekly batch `claim_reward` per winner |

The `pending_mints` table is the only place where a backend-side
intent currently lives without a corresponding on-chain effect; the
Anchor relayer worker that drains it is on the v2 roadmap.

## Anti-cheat layers (defence in depth)

1. **Client-side determinism**. Engine is integer-stepped, no
   floating-point drift. RNG seeded from
   `SHA-256(player || level || daily_epoch)`.
2. **Backend replay** (`backend/src/verify.ts`). Sanity-checks each run
   (level bounds, kills bounded, no negative score, plausible time)
   and rejects anything outside replay-bound tolerance.
3. **ed25519 signature** chains the backend's `OK` verdict into the
   on-chain layer — no signed verdict, no claim.
4. **`(claimer, nonce)` replay-protect** at the program level —
   double-spending a verdict is a PDA collision.
5. **Per-`(claimer, daily_epoch)` cap** at the program level (planned
   PDA, currently enforced only in the backend) limits a stolen
   signer's blast radius.
6. **MWA + Seed Vault** raises the per-account hardware cost for Sybil
   farms.
