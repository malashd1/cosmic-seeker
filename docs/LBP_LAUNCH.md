# LBP Launch Runbook

## Why an LBP

A Liquidity Bootstrapping Pool (LBP) is the cleanest way to put `$SKR` into the open market with **price discovery instead of speculation**. The pool starts heavily weighted toward `$SKR` (90/10) and glides to balanced (50/50) over 48 hours. Without buyers, the implied price drops. With buyers, the price stabilises at the level demand supports. The mechanism punishes snipers and rewards measured buyers.

Fjord Foundry on Base wraps Balancer V2 LBPs with a nicer UX. We use the underlying Balancer pool factory directly so we are not coupled to Fjord's front-end.

## Pre-launch checklist

- [ ] `SeekerToken` deployed and held in Treasury (full 1B supply).
- [ ] Treasury holds the USDC seed amount (target $50,000 minimum).
- [ ] LBP owner is the **Safe multisig** (not a hot wallet).
- [ ] Both audits closed (no open critical/high findings).
- [ ] Bug bounty has been live ≥30 days.
- [ ] Public communication scheduled: T-24h announcement, T-1h thread, T-0 swap-enabled tweet.
- [ ] Aerodrome pair created (empty) so post-LBP migration is one transaction.

## Parameters

| Variable | Value |
|---|---|
| Pool | Balancer V2 LBP via Fjord factory |
| Tokens | SKR / USDC |
| Start weights | 90% SKR / 10% USDC |
| End weights | 50% SKR / 50% USDC |
| Duration | 48 hours |
| Swap fee | 1% |
| Seed SKR | 50,000,000 (5% of supply) |
| Seed USDC | $50,000 (treasury) |

Implied **starting price** at 90/10 weights:
- 50M SKR × 0.9 weight = 45M weighted units
- 50k USDC × 0.1 weight = 5k weighted units
- Price per SKR ≈ (50k × 0.1) / (50M × 0.9) ≈ **$0.000111**

Implied **floor at 50/50** (no buyers):
- (50k × 0.5) / (50M × 0.5) ≈ **$0.001**

So with zero participation the price walks from $0.0001 → $0.001 over 48h. With participation, supply imbalance corrects and price settles at fair clearing.

## Run

```bash
cd contracts
export DEPLOYER_PK=0x...                    # or use --ledger
export SKR_ADDRESS=0x...                   # from Deploy.s.sol output
export USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
export LBP_FACTORY=0x...                    # Fjord LBP factory (Base mainnet)
export BALANCER_VAULT=0xBA12222222228d8Ba445958a75a0704d566BF2C8
export LBP_OWNER=0x...                      # Safe multisig
export SKR_SEED_AMOUNT=50000000000000000000000000   # 50M * 1e18
export USDC_SEED_AMOUNT=50000000000                  # 50k * 1e6
export START_TIMESTAMP=...                  # T-0 unix seconds
export END_TIMESTAMP=...                    # START + 48*3600

forge script script/DeployLBP.s.sol \
  --rpc-url base \
  --broadcast --verify -vv
```

The script:

1. Sorts tokens (Balancer requires ascending address order).
2. Builds 90/10 start weights and 50/50 end weights, in token-sorted order.
3. Calls `factory.create(...)` with `swapEnabledOnStart = false` (the pool is closed until T-0).
4. Approves both tokens to the Balancer Vault.
5. Performs the `INIT` joinPool with the full seed amounts. BPT shares go to the multisig owner.
6. Calls `updateWeightsGradually(start, end, endWeights)` so the curve is locked in by the contract.

## At T-0

The Safe multisig sends a single transaction:

```solidity
ILBP(pool).setSwapEnabled(true);
```

After this, the public can swap into the pool through Fjord or any Balancer V2 router (1inch, ParaSwap, etc.).

## At T+48h

```solidity
ILBP(pool).setSwapEnabled(false);
vault.exitPool(...);   // multi-step: withdraw both tokens from the LBP
```

Proceeds split (executed via separate multisig transactions, all public):

| Bucket | Share | Action |
|---|---:|---|
| Aerodrome LP | 50% | Pair `SKR/USDC` concentrated liquidity, LP NFT locked for 24 months |
| Treasury | 30% | Held by Safe + 7-day timelock |
| Buy-back-and-burn | 20% | Market-buy SKR and burn via `Treasury.executeBuyback` |

## Failure modes

| Scenario | Response |
|---|---|
| Sniper-bot frontruns enable | Mitigation: `swapEnabledOnStart=false`; enable Tx is a multisig action with several seconds of public anticipation, levelling the playing field. |
| Pool gets no demand | Outcome: price reaches floor ~ $0.001; 50/50 ratio; we still migrate to Aerodrome and let Aerodrome handle ongoing price discovery. |
| Sudden USDC spike (whale dump) | The 1% swap fee absorbs a small portion; if total deviation > expected, pause via `setSwapEnabled(false)` (governance call). |
| Critical bug found during sale | Pause via `setSwapEnabled(false)`. Refunds executed by exiting pool and reimbursing buyers from on-chain swap logs. |

## Post-launch

Within 24 hours of LBP close:

- Publish on-chain proof of: LBP exit, Aerodrome LP creation, LP lock NFT, BBB transactions, treasury balance.
- File the official `$SKR` listing application with CoinGecko, CoinMarketCap, and DefiLlama.
- Open the play-to-earn rewards pipeline by calling `RewardsDistributor.setPaused(false)`.
- Announce the airdrop claim window (week 2).
