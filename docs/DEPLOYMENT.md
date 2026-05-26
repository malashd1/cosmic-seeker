# Deployment

End-to-end pipeline for shipping CosmicSeeker — Anchor program on Solana,
Express + SQLite backend behind Caddy, Capacitor-Android APK signed and
listed on the Seeker dApp Store.

This file is the **index** that ties the per-component guides together
in the order they need to run. Each step links to the dedicated doc
with the exact commands and troubleshooting.

```
                    ┌──────────────── one-time, per release line ──────────────┐
   Solana keypair ──┤                                                          │
   ────────────────►│  1. SKR SPL mint  ─►  3. Anchor deploy  ─►  4. initialize  │
                    │       (decimals 6)         (program id)        (Config PDA)│
                    └────────────────────────────────┬─────────────────────────┘
                                                     │
                                                     ▼
   Domain DNS A     ┌────────────── per release ─────────────────┐
   ────────────────►│  2. Backend (Caddy + Docker compose)        │
                    │     env: SIGNER_KEYPAIR_BASE58 + CORS_*     │
                    └─────────────────────┬──────────────────────┘
                                          │
   Release keystore                       ▼
   ────────────────►   5. Frontend .env.production
                       (program id + SKR mint + treasury baked in)
                                          │
                                          ▼
                       6. Signed APK  ─►  7. dApp Store submit
                                          │
                                          ▼
                       8. Smoke-test:  curl /api/health
                                       claim flow on devnet
                                       buy flow on devnet
```

## Environments

| Env | Solana cluster | Backend host | APK channel |
|---|---|---|---|
| local | `solana-test-validator` | `localhost:8787` | `assembleDebug` install via `adb` |
| devnet | `api.devnet.solana.com` | `cosmic.soulview.org` (Caddy + Docker) | Debug APK with `VITE_BACKEND_URL_TEST=https://cosmic.soulview.org` |
| mainnet | `api.mainnet-beta.solana.com` | TBD (production host) | Release APK signed with the upload keystore, listed on the Seeker dApp Store |

## Prereqs (one-time per dev machine)

```bash
# Node + Vite + Capacitor build chain.
nvm install 20 && nvm use 20

# Solana CLI (Anza fork is canonical in 2026).
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor (Rust + AVM).
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# Android toolchain (only needed for APK builds).
brew install --cask android-platform-tools     # macOS
# or: sudo apt install android-sdk             # Debian/Ubuntu
# Plus Android Studio SDK (sdkmanager) for `gradlew assembleRelease`.

# Backend host.
ssh user@cosmic.soulview.org "curl -fsSL https://get.docker.com | sh"
```

## 1. Create the `$SKR` SPL mint

One-shot per release line. Decimals **must** match
`VITE_SKR_DECIMALS_TEST` / `_DECIMALS` in the frontend env (default 6).

```bash
# Mint authority is your local keypair for now; transferred to the
# Config PDA in step 4 via `set_authority`.
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase
solana airdrop 2 -u devnet
spl-token create-token --decimals 6 -u devnet
# → Creating token <SKR_MINT>
spl-token create-account <SKR_MINT> -u devnet
spl-token mint <SKR_MINT> 100000000 -u devnet   # 100M, full supply
```

Capture `<SKR_MINT>` — it goes into the program initializer + the
frontend env.

## 2. Backend — `cosmic.soulview.org`

Full walkthrough: **[`DEPLOY-COSMIC-SOULVIEW.md`](DEPLOY-COSMIC-SOULVIEW.md)**.

Highlights:

```bash
# from cosmic-seeker/backend on your laptop
rsync -av --exclude node_modules --exclude '*.db*' . user@cosmic.soulview.org:~/cosmic-seeker/

# on the server
ssh user@cosmic.soulview.org
cd ~/cosmic-seeker
cp .env.production.template .env
docker compose -f docker-compose.production.yml up -d --build
curl https://cosmic.soulview.org/api/health
# → {"ok":true,"signerPubkey":"4mX…","rpcUrl":"…devnet…"}
```

The `SIGNER_KEYPAIR_BASE58` env value is the base58-encoded 64-byte
ed25519 secret key whose pubkey gets registered with the on-chain
program in step 4.

## 3. Anchor program — deploy

Full walkthrough: **[`DEPLOY-ANCHOR-PROGRAM.md`](DEPLOY-ANCHOR-PROGRAM.md)**.

```bash
cd program
anchor build && anchor keys sync           # mint + sync the on-chain id
solana airdrop 4 -u devnet                 # wrapper bails under 4 SOL
npm install
npm run deploy:devnet
# ✔ Deployed.
#    program id : <PROGRAM_ID>
```

The wrapper refuses to deploy with the placeholder `declare_id!()`,
checks deployer balance, and gates mainnet behind
`COSMIC_CONFIRM_MAINNET=yes`.

## 4. Anchor program — initialize

```bash
# pubkey side of the backend SIGNER_KEYPAIR_BASE58 (printed at
# backend boot in the `server.boot` log line, also available via
# `curl https://cosmic.soulview.org/api/health` → signerPubkey).
SIGNER_PUBKEY=<paste-from-step-2>
SKR_MINT=<from-step-1>
TREASURY=<your treasury wallet or PDA>

npm run initialize -- \
  --cluster devnet \
  --signer-pubkey "$SIGNER_PUBKEY" \
  --skr-mint     "$SKR_MINT" \
  --treasury     "$TREASURY"
# ✔ initialize sent. tx: 4P1i…
```

The `Config` PDA is now seeded; the program is live.

> **Transfer SKR mint authority to the Config PDA** so the program can
> mint future emissions if/when needed. (Or: revoke entirely and have
> the rewards pool seeded from the treasury vault — that's the path
> documented in `TOKENOMICS.md`.) Either way, the human who minted the
> 100M no longer needs that authority.

## 5. Frontend `.env.production` — wire the addresses

Edit `cosmic-seeker/.env.production`:

```env
VITE_DEFAULT_NETWORK=devnet
VITE_BACKEND_URL_TEST=https://cosmic.soulview.org
VITE_BACKEND_URL=https://cosmic.soulview.org
VITE_SOL_RPC_TEST=https://api.devnet.solana.com
VITE_SKR_MINT_TEST=<SKR_MINT from step 1>
VITE_TREASURY_TEST=<TREASURY from step 4>
VITE_COSMIC_PROGRAM_ID_TEST=<PROGRAM_ID from step 3>
VITE_SKR_DECIMALS_TEST=6
# repeat for VITE_*_TEST → VITE_* when shipping to mainnet
```

## 6. Signed release APK

Full walkthrough: **[`RELEASE-APK.md`](RELEASE-APK.md)**.

```bash
# one-time: mint a keystore.
keytool -genkeypair -v -keystore ~/keys/cosmic-release.jks \
  -storetype JKS -keyalg RSA -keysize 4096 -validity 10000 -alias cosmic

# every release:
export COSMIC_KEYSTORE_PATH=~/keys/cosmic-release.jks
export COSMIC_KEYSTORE_PASSWORD='…'
export COSMIC_KEY_ALIAS=cosmic
export COSMIC_KEY_PASSWORD='…'
npm run android:apk:release
# → dist-release/CosmicSeeker-release.apk  (also mirrored to ~/Downloads)
```

The script validates env vars and the keystore file path before
running Gradle. Signature can be verified with
`apksigner verify --verbose dist-release/CosmicSeeker-release.apk`.

## 7. Seeker dApp Store

Full walkthrough: **[`../dapp-store/README.md`](../dapp-store/README.md)**.

```bash
npm i -g @solana-mobile/dapp-store-cli

# Fill in the TODO markers in dapp-store/config.yaml first:
#  - publisher / app / release wallet pubkeys
#  - signing_subject / signing_sha256 (keytool -list -v output)
# Replace dapp-store/media/screenshot-*.png with real device captures.

dapp-store validate ./dapp-store/config.yaml
dapp-store create publisher  --keypair ~/keys/publisher.json --config ./dapp-store/config.yaml
dapp-store create app        --keypair ~/keys/publisher.json --config ./dapp-store/config.yaml
dapp-store create release    --keypair ~/keys/publisher.json --config ./dapp-store/config.yaml \
  --signed-apk ../dist-release/CosmicSeeker-release.apk
dapp-store publish submit    --keypair ~/keys/publisher.json --config ./dapp-store/config.yaml
```

## 8. Smoke-test (end-to-end on devnet)

After steps 1–6 are green:

```bash
# Backend up?
curl -fsS https://cosmic.soulview.org/api/health
# → {"ok":true,"signerPubkey":"…","rpcUrl":"…devnet…"}

# Frontend serves?
curl -fsSI https://cosmic.soulview.org/   # 200 OK

# Install the debug APK on the test device.
adb install -r ~/Downloads/CosmicSeeker-debug.apk

# On the phone:
#   1. Open CosmicSeeker, tap CONNECT WALLET → MWA prompt → Seed Vault.
#   2. PRESS START → clear LV 1.
#   3. NEXT LEVEL → at LV 2 clear, screen shows "Claimed +N POINTS".
#   4. SHOP → tap BUY on any item → MWA prompt → tx confirmed.
#   5. SETTINGS → HUD SKR balance reflects the spend.
```

If any step is red, see the troubleshooting table in
[`DEPLOY-COSMIC-SOULVIEW.md`](DEPLOY-COSMIC-SOULVIEW.md) (backend) or
[`DEPLOY-ANCHOR-PROGRAM.md`](DEPLOY-ANCHOR-PROGRAM.md) (program).

## 9. Rollback / kill-switch

| Scenario | Action |
|---|---|
| Backend bug | `docker compose -f docker-compose.production.yml restart backend` — SQLite state survives. If the bug is in the schema, restore from the encrypted nightly dump. |
| Program bug, treasury still safe | Stop the frontend from sending claims by setting `VITE_COSMIC_PROGRAM_ID_TEST=` empty and re-publishing the build. Backend keeps signing off-chain claim payloads as POINTS only; on-chain `claim_reward` becomes unreachable. |
| Program bug, exploitable | Pause the backend signer (rotate `SIGNER_KEYPAIR_BASE58`) — without a valid signature, `claim_reward` reverts. The treasury vault stays intact behind the Config PDA. |
| Compromised keystore | You cannot rotate within the same `applicationId`. Mint a fresh keystore, bump `applicationId` (e.g. `xyz.cosmicseeker.app2`), publish as a new listing. Communicate the migration to players. |

## 10. Cost estimate (devnet → mainnet)

| Step | Mainnet cost (est.) |
|---|---:|
| Create SKR mint (`spl-token create-token`) | ~0.0015 SOL |
| Anchor program deploy | ~3.5 SOL (proportional to `.so` size) |
| `initialize` ix + `Config` PDA rent-exemption | ~0.002 SOL |
| Treasury SKR ATA + first 100M mint | ~0.0015 SOL |
| dApp Store publisher + app + release accounts | ~0.015 SOL combined |
| Per-claim cost (paid by player) | ~5,000 lamports (~$0.0005) |
| Per-buy_item cost (paid by player) | ~5,000 lamports + 2× ATA rent if their SKR / buyer ATA doesn't exist yet (~0.002 SOL) |

Budget ~4 SOL on hand for the deployer wallet on mainnet day.

---

For deeper details on any single component, jump to its dedicated doc:

- [DEPLOY-COSMIC-SOULVIEW.md](DEPLOY-COSMIC-SOULVIEW.md) — backend (Caddy + Docker)
- [DEPLOY-ANCHOR-PROGRAM.md](DEPLOY-ANCHOR-PROGRAM.md) — Solana program (deploy + initialize)
- [RELEASE-APK.md](RELEASE-APK.md) — signed Android APK
- [../dapp-store/README.md](../dapp-store/README.md) — Seeker dApp Store listing
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime layout + trust boundaries
