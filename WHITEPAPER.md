# CosmicSeeker — Whitepaper

**Version 2.0 — May 2026**

## 1. Thesis

Arcade games created the modern entertainment industry. Quarters into
cabinets became a $200B business. The on-chain analogue — open economies
around skill-based play — has been promised since CryptoKitties but
rarely delivered. Most "GameFi" titles failed two tests:

1. **The game wasn't fun**, so the only player was a yield farmer.
2. **The token economy was an unsustainable Ponzi**, so emission outran
   sinks and the token went to zero.

CosmicSeeker is built to pass both tests. It is, first, a tight
Galaxian-style arcade game with 100 hand-tuned levels and the kind of
feel that rewards practice. Second, its economy is engineered around
durable sinks and a halving emission curve, on a chain — **Solana**, with
the **Seeker phone** as the canonical client — that makes onboarding
effectively free.

> Earlier drafts of this paper targeted Base. The current build is
> Solana-native; the legacy Solidity contracts live under `legacy-evm/`
> as an audit reference but are not part of the live system. See
> [§ 11 Migration history](#11-migration-history-from-base) for context.

## 2. Why Seeker / Solana

- **Seeker is a crypto-first phone.** Hardware-bound **Seed Vault** key
  custody removes the seed-phrase problem and raises the cost floor for
  Sybils: a meaningful fraction of CosmicSeeker accounts cost ~$450
  (hardware) plus the keystore session, not "a free Phantom install."
- **Mobile Wallet Adapter (MWA)** is the on-device signing primitive.
  One tap on the player's phone replaces the wagmi / WalletConnect /
  Coinbase-Smart-Wallet stack that the EVM build needed.
- **Transaction fees collapse.** Solana's base-tx cost is ~5,000
  lamports (~$0.0005). Claiming 1 `$SKR` costs less than the reward
  itself; no paymaster scaffold needed.
- **Generous compute.** A single Solana tx can carry an `Ed25519` syscall
  *plus* multiple SPL CPIs (claim payload verify, treasury → claimer
  transfer, nonce PDA init) inside the default 400 k CU budget — what
  used to be a multi-tx EIP-712 flow becomes one wallet prompt.
- **Distribution.** The Solana Mobile dApp Store ships installed on every
  Seeker phone; the team curates listings and rewards developers.
- **Liquidity.** USDC depth is excellent on Solana (Jupiter aggregation,
  Orca Whirlpools, Meteora). The launch venue is an
  Orca `$SKR / USDC` Whirlpool seeded after a 72 h Meteora Alpha Vault
  fair launch.

## 3. The game

### 3.1 Setup

You pilot one of five ships. Enemies arrive in formations from the top
of the screen, descend, and fire. You shoot up. Touch an enemy or a
bullet, lose a life. Run out of lives, the run ends. Score and `$SKR`
rewards depend on level cleared, accuracy, no-hit streak, and time.

### 3.2 Progression

- **100 levels**, 6 difficulty tiers:
  - 1–10 Tutorial, 11–30 Normal, 31–50 Hard, 51–70 Expert,
    71–90 Master, 91–100 Legendary.
- Boss every 10th level.
- Levels unlock sequentially. Re-runs allowed; first-clear bonus is 2×.

### 3.3 Enemy roster (12 types)

| # | Enemy | Tier intro | Behaviour | Reward (base) |
|---:|---|---:|---|---:|
| 1 | Grunt | 1 | Stays in formation, fires straight | 10 |
| 2 | Drone | 1 | Formation, dives toward player periodically | 15 |
| 3 | Scout | 5 | Fast horizontal weaving, single shots | 25 |
| 4 | Sniper | 11 | Stationary edge, charged aimed shots | 40 |
| 5 | Bomber | 16 | Drops AoE explosive bombs | 55 |
| 6 | Splitter | 21 | On death, splits into 2 Grunts | 60 |
| 7 | Phantom | 26 | Phases in/out of visibility, dive attack | 75 |
| 8 | Swarmer | 31 | Spawns in groups of 6, kamikaze | 35 each |
| 9 | Turret | 36 | Heavy armor, 360° turret fire | 100 |
| 10 | Reaper | 51 | Tracks player with homing missile (1 per cycle) | 120 |
| 11 | Mirror | 61 | Reflects 1 bullet back per second | 150 |
| 12 | Voidling | 76 | Teleports near player, melee dash | 180 |
| Boss-A | Carrier | 10 | Spawns Drones + barrage | 1,000 |
| Boss-B | Hive | 20 | Spawns Swarmers + lasers | 1,500 |
| Boss-C | Warden | 30 | Shielded phases, 360° spread | 2,000 |
| Boss-D | Inquisitor | 40 | Aimed lasers + Phantom adds | 3,000 |
| Boss-E | Leviathan | 50 | Multi-segment serpent | 5,000 |
| Boss-F | Architect | 60 | Builds turret grid mid-fight | 7,500 |
| Boss-G | Devourer | 70 | Consumes bullets, regurgitates them | 10,000 |
| Boss-H | Echo | 80 | Mirrors the player's ship and weapon | 15,000 |
| Boss-I | Cataclysm | 90 | Screen-wide bullet hell phases | 25,000 |
| Boss-J | The Sovereign | 100 | Composite of all prior mechanics | 100,000 + Legendary equip drop |

### 3.4 Ships

| Tier | Ship | HP | Speed | Slots | Cost |
|---:|---|---:|---:|---:|---|
| 0 | Scout | 1 | 5 | 1 weapon | Free (default) |
| 1 | Striker | 2 | 5 | 1 weapon, 1 utility | 0.04 SOL / 50 SKR |
| 2 | Vanguard | 3 | 4 | 2 weapons, 1 utility | 0.10 SOL / 150 SKR |
| 3 | Phantom | 2 | 7 | 1 weapon, 2 utility | 0.25 SOL / 400 SKR |
| 4 | Titan | 5 | 3 | 2 weapons, 2 utility, 1 shield | 0.75 SOL / 1,200 SKR |

### 3.5 Equipment

Categories: weapons (single, double, spread, laser, plasma, homing),
shields (basic, pulse, reactive, quantum), utility (bomb, slow-mo,
magnet, score-x2, drone), cosmetics (skins, particles, soundtracks).

Equipment has 5 rarities: Common, Uncommon, Rare, Epic, Legendary. Drop
rates are deterministic from `SHA-256(player_pubkey || level_id ||
daily_epoch)` so the server can replay and validate every drop; for
high-value drops a future revision swaps in **Switchboard On-Demand
Randomness** so the player's wallet can verify the drop independently.

### 3.6 Inventory representation (a deliberate scope cut)

The EVM build represented ships as ERC-721s and equipment as ERC-1155s.
The Solana port keeps **inventory off-chain** for v1:

- The on-chain layer is just the `$SKR` SPL mint plus the program
  events (`BuyItemEvent`, `ClaimRewardEvent`).
- The backend SQLite ledger is the inventory source of truth, indexed
  from `BuyItemEvent` (wallet, item_id, qty, signed by the player
  themself via the program tx).
- The wallet's signature on the on-chain `buy_item` IS the proof of
  ownership — anyone with a Solana RPC can reconstruct any wallet's
  inventory from the event log.

This trades NFT-style transferability for a much simpler UX and a far
cheaper economic loop (no per-item mint cost). Transferable Metaplex
Token-2022 (or Compressed NFTs for cosmetics) ship in v2 once the
ungated SKR economy is proven.

## 4. Token

See [TOKENOMICS.md](TOKENOMICS.md). Summary:

- **100M fixed supply, 6 decimals, SPL Token standard.**
- 40 % to play-to-earn over 48 months, halving annually.
- 15 % TGE community + airdrop, 15 % liquidity (Orca Whirlpools +
  Meteora), 12 % team, 8 % investors, 10 % treasury (Realms multi-sig).
- Sinks: equipment minting (50 % burn / 50 % treasury), continues,
  crafting, cosmetics — 50–100 % burn rates.
- Buy-back-and-burn from shop revenue, executed weekly via Clockwork
  cron threads routing through Jupiter.
- Launch peg 1 SKR = $0.10 (FDV $10M).

## 5. Architecture

### 5.1 Boundary

```
[ Seeker phone — Capacitor WebView ]
   │
   ├─ Game (Canvas 2D, fixed-step 60 Hz, deterministic, seeded by
   │   chain epoch + wallet pubkey)
   ├─ Wallet (Mobile Wallet Adapter; Phantom fallback in browser)
   │
   ├──── HTTPS ────► [ Backend (Express + better-sqlite3) ]
   │                  • Replays run from seed + inputs, verifies score
   │                  • Signs ed25519 attestation over canonical
   │                    claim payload (SHA-256 digest)
   │                  • Maintains weekly leaderboard + daily missions
   │                  • Indexes BuyItemEvent / ClaimRewardEvent into
   │                    the inventory ledger
   │                  • Stripe webhook → queue pending_mints for the
   │                    Anchor `buy_item` relayer
   │
   └──── RPC ──────► [ Solana mainnet-beta ]
                      • SPL `$SKR` mint (decimals 6, supply 100M)
                      • CosmicSeeker Anchor program
                          - initialize (one-shot)
                          - claim_reward(level_id, score, amount,
                            nonce, expiry)  ← verifies ed25519 sig
                            in the leading Ed25519 verify ix, transfers
                            SKR via PDA-signed CPI, anti-replay PDA
                          - buy_item(item_id, qty, price)
                            ← 50 % burn / 50 % treasury split
                      • Treasury (multi-sig wallet, holds USDC + LP
                        positions; Clockwork-driven BBB executor)
```

### 5.2 Determinism + anti-cheat

The game is **deterministic** given (seed, input stream). The seed is
`SHA-256(player_pubkey || level_id || daily_epoch)`. The client records
input timestamps (60 Hz quantised). On run end:

1. Client POSTs `{ levelId, seed, inputs, claimedScore }` to backend.
2. Backend runs the same engine headlessly with the seed and inputs.
3. If `computedScore == claimedScore ± tolerance` and time is
   plausible, backend builds the canonical claim message
   `[u8 player_len][player_utf8][u16 BE level_id][u64 BE score][u128
   BE amount][u64 BE nonce][u64 BE expiry]`, SHA-256s it, signs the
   digest with its ed25519 secret key, returns the base58 signature.
4. Player wallet wraps a transaction containing:
   - `Ed25519Program::verify` (carrying the same digest, the backend's
     pubkey, and the 64-byte signature)
   - `cosmic_seeker::claim_reward(...)` — the program introspects the
     instructions sysvar, confirms ix[0] is a real Ed25519 verify whose
     pubkey matches `Config.signer_pubkey` and whose message digest
     equals the on-chain recomputed `sha256(canonical_msg)`, then
     transfers SKR.
5. Anti-replay: the program initialises a per-`(claimer, nonce)` PDA
   (seeds `[b"nonce", claimer, nonce_le8]`). A second claim with the
   same nonce collides on `init` and reverts at no cost to the chain.

This means: **the chain trusts the backend's verification, and the
backend trusts only deterministic replay**. Cheating requires either
(a) breaking the backend (private-key compromise — protected by HSM /
KMS), or (b) finding an input stream that produces a high score under
the same engine — which is just being good at the game.

## 6. Monetisation paths

| Path | Asset | UX | Backend involvement |
|---|---|---|---|
| Crypto-native | SOL | Tap "BUY" → MWA prompt → on-chain tx | None |
| Crypto-native | USDC (SPL) | Same as above, different ATA | None |
| Token-native | `$SKR` (15 % discount) | Same flow; program enforces the discount via Pyth + Orca TWAP | None |
| Fiat onramp | Stripe → USDC | Card payment, on-chain mint relayed later | Stripe webhook queues a row in `pending_mints`; a worker drains it via the Anchor `buy_item` instruction |
| Gift / promo code | Off-chain code | Code → backend signs claim → player wallet sends tx | Promo signer key, daily cap |

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Backend signer compromise | Hardware KMS, multi-sig override to rotate the registered `signer_pubkey` via a future `set_signer` admin ix, daily-cap-per-wallet at program level |
| Program bug | Two independent audits before mainnet; Anchor IDL frozen at audit time; bug bounty up to 10 % of treasury |
| Bot farms | MWA + Seed Vault hardware floor for claims > 5 SKR / week, per-IP rate limit at `/api/run/verify`, score attestation depends on replay |
| Token dump on TGE | Team + investor cliffs (Streamflow streams), liquidity locked 24 mo, buyback funded from real shop revenue |
| Regulatory | Token marketed as utility only; no investment promises; team KYC; legal opinion from a Solana-friendly jurisdiction prior to TGE |
| Game gets boring | 100 levels is the launch content; new levels every quarter; community-designed levels in v2 |
| Solana network outage | Backend leaderboard + mission progress stays writable through chain downtime; claims defer and resume once the chain catches up |

## 8. Timeline (high-level)

| Quarter | Milestone |
|---|---|
| Q2 2026 | Internal alpha, full 100 levels playable; Anchor program tests green on `solana-test-validator` |
| Q3 2026 | Closed beta with 500 players on Seeker hardware; audit #1; devnet program deployed; backend on cosmic.soulview.org |
| Q4 2026 | Public beta, airdrop announced, audit #2, Meteora Alpha Vault fair launch |
| Q1 2027 | TGE on Orca Whirlpools, rewards live, full P2E |
| Q2 2027 | Governance (veSKR via Realms), creator levels, Compressed NFT cosmetics |
| Q3 2027 | Cross-platform: same backend serves a Capacitor-iOS build via App Clip + a desktop web build |

## 9. Team

To be added. Cap-table and individual identities disclosed at audit
phase. All team and investor unlocks scheduled via on-chain Streamflow
streams, viewable on the program's treasury page.

## 10. Disclaimer

`$SKR` is a utility token. No promises of price appreciation, ROI, or
financial return are made by this paper, the team, or any affiliated
party. Gameplay is provided as-is. Jurisdictions vary on the regulatory
status of in-game tokens; players are responsible for compliance with
their local law.

## 11. Migration history (from Base)

CosmicSeeker began life as **BaseStriker on Base**. The current build
is a clean port, not a bridge: nothing on Base talks to anything on
Solana, and the legacy Solidity tree under `legacy-evm/` is kept only
as an audit reference for the Anchor program.

What survived the migration:

- The game itself (Canvas 2D engine, 100 levels, 12 enemies, 10 bosses,
  shop catalogue, daily missions, weekly tournaments) — entirely
  unchanged except for branding.
- The economic model (halving emission curve, sink categories, BBB,
  daily cap, veSKR governance) — rescaled to the new $0.10 launch peg
  but structurally identical.
- The off-chain backend (Express + SQLite, score replay, EIP-712-style
  attestation) — refactored from secp256k1 / EIP-712 to ed25519 /
  SHA-256-digest, retaining the deterministic-replay anti-cheat
  guarantee.

What was rebuilt:

- **Smart contracts → Anchor program.** The Solidity tree (Treasury,
  ShipNFT, EquipmentNFT, PaymentRouter, RewardsDistributor,
  GameRegistry) is archived under `legacy-evm/`. The Solana port
  collapses these into a single program (`initialize` + `claim_reward`
  + `buy_item`) plus the SPL mint.
- **Wallet stack.** wagmi / viem / Coinbase Smart Wallet → Mobile
  Wallet Adapter / Phantom-injected fallback. The frontend's
  `src/web3/wallet.ts` is now ~140 lines instead of ~600.
- **Distribution.** Web-first PWA → Capacitor-Android APK targeting
  the Solana Mobile dApp Store as primary channel. The same web bundle
  still runs in a desktop browser via Phantom.
- **NFT layer.** ERC-721 ships + ERC-1155 equipment removed for v1
  (see § 3.6); will return as Metaplex Token-2022 / Compressed NFTs in
  v2.

The migration is also why the on-chain economy is leaner: it was easier
to ship a single Anchor program with two payable instructions than to
port six interlocking Solidity contracts.
