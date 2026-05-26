# CosmicSeeker

<div align="center">

![Solana](https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white)
![Seeker](https://img.shields.io/badge/Seeker-AB9FF2?style=for-the-badge&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-4cff7a?style=for-the-badge)

**A Galaxian-style retro arcade shooter that pays in $SKR on Solana mainnet. Built for Solana Seeker.**

[🎮 Play in browser](https://cosmic.soulview.org) · [📜 Terms](https://cosmic.soulview.org/legal/terms) · [🛡 Privacy](https://cosmic.soulview.org/legal/privacy)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎮 **100 levels** | 12 enemy types, 10 hand-crafted bosses (every 10th level) |
| 💜 **$SKR payments** | Buy in-game boosts in $SKR (SPL token) — direct transfer to treasury |
| 📱 **Seeker-native** | TWA Android app, Mobile Wallet Adapter, Seed Vault one-tap sign |
| 🔁 **Multi-wallet** | MWA on Seeker / Phantom / Backpack / Solflare via Wallet Standard |
| 🏆 **Onchain leaderboard** | Per-wallet, anti-cheat verified runs, weekly + lifetime |
| 🎯 **Daily missions** | Rotate per-day, signed-reward claims, 4 mission types |
| 🛡 **Anti-cheat** | Replay-bound score verification + signed claim attestations |

## 🎯 How it works

```
   Player                  Backend                     Solana mainnet
   ──────                  ───────                     ──────────────
   Plays level
   Clears it      ──→  POST /api/run/verify
                       (replay-bound checks)
                       ←──  signed verdict
   Opens shop
   Taps BUY       ──→  SPL transfer:
                       buyer ATA → treasury ATA
                       ←──  on-chain confirmation
   Boost credited
```

The shop sends a plain SPL `transferChecked` from the buyer's $SKR ATA to the treasury's $SKR ATA. Wallet handles signing via Wallet Standard.

## 🏗 Repo layout

```
cosmic-seeker/
├── src/                  # Game client — TypeScript + Canvas 2D
│   ├── game/             # Engine: Player, Enemy, Formation, Boss, Bullet, Particle
│   ├── web3/             # Wallet Standard discovery, SPL transfer, balance watcher
│   ├── ui/               # Menu, shop (with SKR balance chip), leaderboard, settings
│   └── style.css         # 8-bit aesthetic + portrait layout (1:2, Seeker-friendly)
├── backend/              # Express API
│   └── src/
│       ├── server.ts     # /api/run/verify, /api/leaderboard, /api/sol-rpc proxy
│       ├── verify.ts     # Anti-cheat: bound checks + replay plausibility
│       ├── missions.ts   # Daily missions (deterministic per wallet)
│       └── shared/       # Anti-cheat replay bounds (shared with client)
├── twa-cosmic/           # Bubblewrap TWA Android wrapper
│   ├── twa-manifest.json # packageId: org.soulview.cosmic
│   └── app/              # Gradle project, signed release builds
├── public/legal/         # Terms of Use + Privacy Policy (dApp Store-ready)
├── scripts/              # Deploy + icon/splash generators
└── program/              # Anchor program (work-in-progress, not yet deployed)
```

## 🚀 Quickstart

### Prerequisites
- Node 20+
- A Solana wallet (Phantom / Backpack / Seed Vault on Seeker) with a few $SKR

### Run locally

```bash
# Frontend
npm install
npm run dev                # http://localhost:5173

# Backend (in another shell)
cd backend
cp .env.example .env       # tweak SIGNER_KEYPAIR_BASE58 for your setup
npm install
npm run dev                # http://localhost:8788
```

### Build for production

```bash
npm run build              # → dist/
cd backend && npm run build
```

### Build signed Android release (TWA)

```bash
cd twa-cosmic
export COSMIC_KEYSTORE_PATH=/path/to/upload-key.jks
export COSMIC_KEYSTORE_PASSWORD=...
export COSMIC_KEY_ALIAS=...
export COSMIC_KEY_PASSWORD=...
./gradlew assembleRelease bundleRelease
# → app/build/outputs/apk/release/app-release.apk
# → app/build/outputs/bundle/release/app-release.aab  (for dApp Store)
```

## 🌐 Live infrastructure

| | Value |
|---|---|
| Web | https://cosmic.soulview.org |
| API | https://cosmic.soulview.org/api |
| Android package | `org.soulview.cosmic` |
| $SKR mint (mainnet) | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |
| Treasury (SKR recipient) | `YhHxMps6i9LRcCPTErs19dEsDD3FYnN1HnDcSLQfPkA` |
| Solana RPC | `cosmic.soulview.org/api/sol-rpc` (same-origin proxy) |

## 🎮 Scoring & economy

**Score** is linear — each enemy kill is worth its flat `ENEMY_REWARDS[kind]` value:

```
grunt 10 · drone 15 · scout 25 · sniper 40 · bomber 55
splitter 60 · phantom 75 · swarmer 35 · turret 100
reaper 120 · mirror 150 · voidling 180
```

Bosses pay 1 000 → 100 000 across LV10 → LV100. No combo multiplier, no level multiplier — clean math, clear ceilings.

**Lifetime POINTS** (separate from per-run score, persists across deaths) come from exactly three sources:
1. Level clears (5–80 PTS per level)
2. Shop purchases (PTS per $SKR spent)
3. The "+100" bonus-score loot drop (flat 5 PTS)

POINTS are an in-game currency — **not a token, not redeemable.**

## 🔐 Wallet integration

Uses [`@solana-mobile/wallet-standard-mobile`](https://www.npmjs.com/package/@solana-mobile/wallet-standard-mobile) to register MWA as a Wallet Standard wallet at boot. The app then discovers wallets via `@wallet-standard/app` `getWallets()`:

- **Seeker phone** → MWA → Seed Vault → one-tap hardware-bound sign
- **Android phone w/o Seeker** → MWA → Phantom / Backpack mobile via Android intent
- **Desktop browser** → Phantom / Solflare / Backpack browser extension

Signs through the `solana:signAndSendTransaction` Wallet Standard feature — same uniform API in every flavour.

## 🛡 Anti-cheat

Per-run plausibility checks live in [`backend/src/shared/replay.ts`](backend/src/shared/replay.ts):

- Score must be ≤ cumulative `Σ maxScoreFor(LV)` for levels played
- Kills must be ≥ `(score − bossReward) / bestReward × 0.8`
- Frame count must match recorded inputs within 4 frames (60 Hz)
- Non-zero score with zero fire inputs is impossible

A signed claim message is generated server-side after verification — the client cannot mint POINTS or move on the leaderboard without a valid backend signature.

## 🗺 Roadmap

- Anchor program deploy on mainnet (`program/`) — adds on-chain `buy_item` with 50/50 burn-split + on-chain claim verification via Ed25519 program
- Seeker dApp Store launch (artefact is signed; submission pending)
- Compressed-NFT cosmetic skins via Metaplex Token-2022

Companion repo:
- [basestriker](https://github.com/malashd1/Basestriker) — same engine on Base / USDC

## 📜 Legal

- [Terms of Use](https://cosmic.soulview.org/legal/terms)
- [Privacy Policy](https://cosmic.soulview.org/legal/privacy)

## 📄 License

MIT — see [LICENSE](LICENSE).

Contact: dima@chisoft.co
