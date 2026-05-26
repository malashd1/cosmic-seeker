# `$SKR` Tokenomics

> The token that powers CosmicSeeker on Solana Seeker. Designed for
> **sustainable emission**, **clear utility**, and **alignment between
> players, holders, and the treasury**.

## TL;DR

| Field | Value |
|---|---|
| Name | CosmicSeeker |
| Symbol | `$SKR` |
| Standard | **SPL Token** (Solana, Token Program v1) |
| Total supply | **100,000,000** (fixed; no inflation post-mint) |
| Decimals | 6 |
| Launch chain | Solana mainnet-beta |
| Mint authority | CosmicSeeker Anchor program (`Config` PDA) — disabled after the initial allocation pour, revoked permanently before the first DEX listing |
| Primary DEX | [Orca Whirlpools](https://orca.so) (`SKR / USDC` concentrated-liquidity), aggregated via [Jupiter](https://jup.ag) |
| Anti-bot launch | [Meteora Alpha Vault](https://docs.meteora.ag/alpha-vault) (72 h fair launch) → Orca Whirlpool migration |
| Launch peg | 1 SKR = $0.10 (FDV $10M) |

`$SKR` is **not a security**. It is a utility token for gameplay rewards,
in-game purchase discounts, equipment crafting, and lightweight governance
over the rewards-pool emission schedule.

---

## Supply allocation (100,000,000 `$SKR`)

| Bucket | % | Tokens | Vesting |
|---|---:|---:|---|
| Play-to-earn rewards pool | 40% | 40,000,000 | 48-month linear emission via the Anchor `claim_reward` instruction |
| Community + airdrops | 15% | 15,000,000 | 25% TGE, 75% over 18 months. Includes retroactive testnet drop, daily missions, partnerships |
| Liquidity (Orca Whirlpools + Meteora) | 15% | 15,000,000 | 100% TGE — paired with treasury USDC. LP positions held by the treasury PDA, lock attested via Streamflow / Coral Bird-style vesting |
| Team | 12% | 12,000,000 | 12-month cliff, 36-month linear (Streamflow stream) |
| Investors (seed) | 8% | 8,000,000 | 6-month cliff, 24-month linear (Streamflow stream) |
| Treasury / dev fund | 10% | 10,000,000 | Realms multi-sig; 6-month cliff, 36-month linear unlock |

Initial circulating supply at TGE: **≈18.75M (18.75%)** — community TGE
portion + DEX liquidity.

The SPL mint authority is held by the program's `Config` PDA only during
the initial pour. Immediately after, a one-shot `revoke_mint_authority`
ix sets the mint authority to `None` — supply becomes irreversibly fixed.
Burns continue via the SPL `burn` instruction (anyone can burn their own
balance; the program burns the 50%-of-`buy_item` share automatically).

---

## Emission curve (rewards pool, 40M tokens)

48 months, **halving every 12 months**:

| Year | Emission | Per day | Per day at $0.10 reference |
|---:|---:|---:|---:|
| 1 | 20,000,000 | 54,794 | $5,479 |
| 2 | 10,000,000 | 27,397 | $2,739 |
| 3 | 5,000,000 | 13,698 | $1,369 |
| 4 | 5,000,000 | 13,698 | $1,369 |

After year 4 emission ends. The game continues; `$SKR` rewards transition
to a **fee-funded** model where in-shop revenue buys `$SKR` from
Jupiter-routed liquidity and recycles into the rewards pool. This is the
long-term equilibrium.

### Per-player daily emission cap

To prevent farms and Sybils:

- Hard cap **20 `$SKR` / wallet / day** in year 1 (scales down with halving).
- Cap enforced on-chain in `claim_reward` via a **per-(claimer, daily_epoch)
  PDA** (seeds `[b"day_cap", claimer, epoch_le8]`) that records the daily
  claimed total. The instruction reverts if `existing + amount > cap`.
- Cap also enforced server-side at `/api/run/verify` so the backend never
  signs an over-cap payout in the first place.

---

## How players earn `$SKR`

Earning is **gated by signed score attestations** from the backend
(`/api/run/verify`). The backend replays the run, verifies the score within
tolerance, and emits an **ed25519 signature** over the canonical claim
payload (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). The on-chain
`claim_reward` instruction validates the signature via the native Ed25519
program before transferring SKR from the treasury vault.

| Source | Reward | Frequency |
|---|---|---|
| Complete level | 5–80 `$SKR` (scales with level, halves over halving epochs) | per level, once per level per day |
| Boss kill (every 10th level) | 100–500 `$SKR` + 1 equipment loot box | per boss, once per day |
| Daily missions (3 rotating) | 25–100 `$SKR` each | daily reset |
| Weekly tournament top 100 | 1k–25k `$SKR` pool split | weekly |
| Streak bonus (7-day login) | +20% multiplier on level rewards | continuous while streak holds |
| First-run-of-level | 2× multiplier | first clear of each level |
| Achievements | 500–5000 `$SKR` | one-time |

All claims are **batched** — players accumulate off-chain in the backend
ledger, then claim on-chain once per session to amortise the (already
near-zero) Solana base fee.

> Solana base fees are ~5,000 lamports (~$0.0005 at current SOL prices),
> so a paymaster layer is unnecessary — unlike the legacy Base build,
> claims are effectively free for players. Priority fees are only set when
> the cluster is congested, and even then stay well under $0.01.

---

## Sinks (where `$SKR` goes to die)

A reward economy without sinks inflates and dies. Four major sinks:

### 1. Ship + equipment minting (50% burn / 50% to treasury)

| Item | `$SKR` cost (year 1 reference) | Alt: USDC |
|---|---:|---:|
| Scout ship (starter) | Free | n/a |
| Striker ship | 50 | $5 |
| Vanguard ship | 150 | $15 |
| Phantom ship | 400 | $40 |
| Titan ship | 1,200 | $120 |
| Common weapon | 5 | $0.50 |
| Rare weapon | 50 | $5 |
| Epic weapon | 250 | $25 |
| Legendary weapon | 1,000 | $100 |
| Loot box (random equipment) | 10 | $1 |

When paid in `$SKR`, **50% is burned, 50% sent to treasury** by the
Anchor `buy_item` instruction (in a single CPI pair: `token::transfer`
then `token::burn`). When paid in USDC via the Stripe onramp,
**30% is queued for a Jupiter market-buy of `$SKR` followed by burn**,
70% to treasury — drained by an off-chain worker that reads the
`pending_mints` table.

### 2. Continue-after-death

`$SKR` 1 / 2.50 / 5 (escalating per death in same run). Paid → 100% burn
via the SPL `burn` instruction.

### 3. Crafting / fusion

Combine two equipment of same tier + `$SKR` fee → 1 equipment of next
tier. `$SKR` fee 100% burn.

### 4. Cosmetics (skins, particles, sound packs)

Pure cosmetic NFTs (Metaplex Token-2022), priced 10–100 `$SKR`. 70% burn,
30% routed to artists.

---

## Pricing in $SKR vs USDC

Every purchase has a `$SKR` price and a USDC price. The Anchor program
reads a **Pyth Network** SOL/USD price feed (and, post-launch, a
direct SKR/USDC TWAP from the Orca Whirlpool pool oracle) to enforce that
paying in `$SKR` is always **15% cheaper** than the USDC price at current
market rate.

This anchors the token's utility value: a player can always burn `$SKR`
for at least 15% extra purchasing power vs. selling on DEX.

---

## Buy-back-and-burn (BBB)

Net revenue (USDC purchases minus infra costs) is allocated:

- **40% → buy `$SKR` via Jupiter → burn**
- **30% → treasury (dev, ops, audits)**
- **30% → rewards pool (refills emission for year 5+)**

BBB executes weekly via a [Clockwork](https://www.clockwork.xyz/) cron
thread (Solana's automation primitive) calling
`treasury_buyback_and_burn`. All swaps route through Jupiter for best
execution; every burn emits an on-chain `BuybackBurnEvent` indexed via
the public Helius webhook stream.

---

## Governance (Phase 2)

After 6 months post-TGE:

- `$SKR` holders can stake into `veSKR` (vote-escrow) — up to 4 years,
  implemented as a Realms-compatible governance mint via the
  [SPL Governance program](https://spl.solana.com/governance).
- `veSKR` votes on:
  - Weekly tournament reward pool size (within bounds)
  - New equipment item parameters
  - Treasury grants
- No control over the emission curve (fixed by the on-chain program).
- No control over team or investor unlock schedules.

Voting is non-binding for the first 3 months (snapshot via the Realms
off-chain voter weight plugin), then transitions to on-chain execution
via the standard Realms `Proposal` + `ProposalTransaction` + 7-day
`hold_up_time`.

---

## Anti-bot / anti-Sybil

- **Mobile Wallet Adapter required** to claim rewards above 5 `$SKR` /
  week. The MWA session embeds the device-bound Seed Vault attestation,
  raising the cost-per-account to ~$450 (Seeker hardware floor).
- **Score attestation** must originate from a server-replayed game
  session — RNG is seeded by `SHA-256(player_pubkey || levelId ||
  dailyEpoch)`, so the server can deterministically replay and validate.
- **Daily wallet cap** (see above), enforced both on-chain and at
  `/api/run/verify`.
- **Per-IP soft rate limiting** at the score-attestation API
  (`rate-limiter-flexible`, 30 req/min default).
- **Stamina** — each ship has a stamina bar (5 lives, regenerates
  1/hour). Burnable with `$SKR` to refill. Prevents 24/7 farming.

---

## Reference economics (sanity check)

Year 1, assumptions:

- 5,000 daily active players (median)
- 50% claim rewards on-chain weekly
- 30% of daily emission is actually claimed (rest forfeited to cap)
- Token price discovery puts $SKR at $0.05–$0.20 in year 1

| Metric | Estimate |
|---|---:|
| Daily emission target | 54,794 `$SKR` |
| Daily emission claimed | ≈16,400 `$SKR` |
| Avg per active player | ≈3.3 `$SKR`/day = $0.16–$0.66 |
| Annual sink burn (ships + equip + continues) | 8M–15M `$SKR` (40–75% of year-1 emission) |
| Net inflation year 1 | ≈+5M–12M `$SKR` to circulating |

This is a deliberately conservative model. The goal is **net deflation
by year 3** once sinks compound and BBB fee-funding kicks in.

---

## Why Solana / Seeker (vs. the legacy Base build)

CosmicSeeker started as BaseStriker on Base. The economics here are
ported, but Solana shifts three things:

1. **Player-side fees collapse.** Solana base fees + Seeker MWA make
   per-claim cost ≈$0.0005, vs. ~$0.05 on Base mainnet at typical gas.
   Paymaster scaffolding is gone — players can claim 1 `$SKR` and not
   pay more in fees than they receive.
2. **Compute budget is generous.** The Anchor program does a real
   `Ed25519` syscall + multiple SPL CPIs in a single tx, well under
   Solana's 400k CU per-ix default.
3. **Seed Vault is the cost floor for Sybils.** Hardware-bound key
   custody on the Seeker phone means a meaningful per-account hardware
   cost, which the previous Smart Wallet passkey requirement only
   approximated.

Decimals dropped from 18 (ERC-20 convention) to 6 (SPL convention),
total supply dropped from 1B to 100M, and the launch peg dropped from
~$0.001 to $0.10 — same circulating-USD market cap at TGE, but with
prices the player actually reads as natural integers (5 SKR for an
extra life, 50 SKR for a ship).
