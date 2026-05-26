# Security

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Send a private report to `security@cosmic-seeker.xyz` with:

- a description of the issue and impact,
- a reproduction (test case, transaction, or steps),
- your preferred contact for follow-up.

We acknowledge within 48 hours and aim to resolve critical issues within 7 days.

## Scope

In scope:

- `program/` — Solana / Anchor program (in development; replaces the legacy EVM contracts)
- `backend/src/*` — server-side score verification and ed25519 signer
- `src/web3/*` — wallet adapter and on-chain integration

Out of scope for bounty (kept as audit reference only):

- `legacy-evm/src/*.sol` — archived Solidity contracts from the BaseStriker era.
  Not built, tested, or deployed by CI; not authoritative for any live system.

Out of scope:

- Issues in dependencies that have a public CVE already (forward to upstream)
- Front-end-only UX bugs that do not affect funds or signatures
- Spam, DOS via valid traffic patterns

## Bug bounty (post-launch)

Hosted on Immunefi. Severity scale follows the Immunefi vulnerability classification system.

| Severity | Reward (USD) |
|---|---:|
| Critical (loss of user funds / pool drain) | up to $500,000 |
| High (privilege escalation, unauthorised mint) | up to $100,000 |
| Medium (denial of claims, theft of small amounts) | up to $20,000 |
| Low (best practice violations with material impact) | up to $5,000 |

## Automated checks (CI)

The Solana / Anchor pipeline (TBD) replaces the EVM Foundry pipeline. The
legacy EVM CI (`.github/workflows/contracts.yml`) only fires when the
archived `legacy-evm/` tree is touched and is not gating for releases.

For historical reference, the original EVM gate ran on every PR touching
`contracts/` (now `legacy-evm/`):

1. **`forge fmt --check`** — code style.
2. **`forge build --sizes`** — compile + contract size budgets.
3. **`forge test -vv`** — unit + replay tests.
4. **`forge snapshot --check`** — gas regression detection.
5. **Slither** — fails on `medium` or higher findings. Config in `legacy-evm/slither.config.json`.
6. **Mythril** — symbolic execution on the 4 critical contracts. Advisory (non-blocking).

See `.github/workflows/contracts.yml`.

## Trust assumptions

The system has a single trust apex: the **backend signer**. All claim payouts and registry updates require an EIP-712 signature from this key.

Protections:

- Signer is a hardware-backed key in production (AWS KMS / GCP Cloud HSM).
- Signer rotation is owner-gated via `setSigner` on `RewardsDistributor` and `GameRegistry`.
- Per-wallet daily cap (`RewardsDistributor.dailyCap`, 2000 SKR) limits maximum exfiltration from a compromised signer.
- Nonces (`nonceUsed`) eliminate replay.
- `Treasury` and contract ownership are held by a Safe multisig with a 7-day timelock; no single-key admin actions are possible on mainnet.

## Known limitations

- The current backend verifier is a **sanity layer only** (input length, score plausibility, kill counts). Full deterministic replay against the same engine is a planned follow-up (`docs/ARCHITECTURE.md`).
- The `Treasury.executeBuyback` low-level call trusts owner-supplied router calldata. Production usage requires the owner multisig to compare calldata against known Aerodrome routes — checklist documented in `docs/DEPLOYMENT.md`.
