# CosmicSeeker Backend

Stateful service that the CosmicSeeker game frontend talks to:

- **`POST /api/run/verify`** — sanity-checks a completed level, applies daily-mission progress, updates the weekly leaderboard, returns an EIP-712 `Claim` signature.
- **`GET  /api/leaderboard`** — top 100 of the current week (optionally `?level=N`).
- **`GET  /api/missions/:addr`** — today's three deterministic daily missions for that wallet.
- **`POST /api/missions/claim`** — marks a completed mission claimed, returns EIP-712 payload.
- **`GET  /api/tournament/today`**, **`POST /api/tournament/submit`**, **`GET /api/tournament/leaderboard`** — daily tournament endpoints.
- **`POST /api/stripe/checkout`** + **`POST /api/stripe/webhook`** — fiat-onramp flow, signed Stripe webhook → relayer mint via `PaymentRouter`.
- **`GET  /api/auth/discord/start|callback`**, **`GET /api/auth/twitter/start|callback`** — OAuth2 social linking (PKCE).
- **`GET  /api/health`** — liveness.

Storage: SQLite (`cosmic-seeker.db`) — WAL mode, single-file, fine up to mid-five-figure DAU. Migrate to Postgres if you outgrow it.

---

## Local development

```bash
cd backend
cp .env.example .env           # signer key falls back to the dev anvil account
npm install
npm run dev                    # tsx watch on http://localhost:8787
curl http://localhost:8787/api/health
```

Set `RPC_URL`, `CHAIN_ID`, and the contract addresses to point at a deployed Sepolia stack (see [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)).

## Production build

```bash
npm run build                  # tsc → dist/
NODE_ENV=production node dist/server.js
```

`NODE_ENV=production` makes the backend **refuse to boot** if any of the following are missing or use dev defaults:

- `SIGNER_KEY` — must NOT be the well-known anvil key.
- `RELAYER_KEY` — must NOT be the well-known anvil key.
- `REWARDS_CONTRACT`, `REGISTRY_CONTRACT`, `PAYMENT_ROUTER` — must be valid 20-byte addresses.
- `RPC_URL` — required.
- `CORS_ALLOWLIST` — required, comma-separated origins.

Boot output is structured JSON (one line per event), pipeable to any log shipper.

## Docker

```bash
# Build the image (multi-stage; ~150MB runtime).
docker build -t cosmic-seeker-backend .

# Run with an .env file + persistent volume for the SQLite DB.
docker run -d --name bsk-backend \
  -p 8787:8787 \
  -v bsk-db:/data \
  --env-file .env \
  cosmic-seeker-backend
```

Or via compose:

```bash
docker compose up -d
docker compose logs -f
```

The image:

- Runs as a non-root user.
- Writes the database to `/data/cosmic-seeker.db` (volume-mounted).
- Has a built-in healthcheck (`fetch /api/health`).
- Compiles `better-sqlite3`'s native bindings in the build stage; the runtime stage is `node:20-bookworm-slim` with no toolchain.

## Reverse proxy

In front of the container, terminate TLS and forward to `:8787`. Caddy example:

```Caddyfile
api.cosmic-seeker.xyz {
    reverse_proxy localhost:8787
    encode zstd gzip
}
```

For Stripe webhooks, the proxy MUST pass the `Stripe-Signature` header through and **must not** reframe the body — Express receives the raw bytes for HMAC verification.

## Operational hooks

| | |
|---|---|
| Logs | stdout JSON. Ship to Loki / Datadog / Loggly. |
| Metrics | none built-in. Add Prometheus exporter when needed. |
| Backup | `cp cosmic-seeker.db cosmic-seeker-$(date +%F).db` while WAL is hot (it stays consistent). |
| Rotate signer key | call `RewardsDistributor.setSigner(new)` from multisig, then update `SIGNER_KEY` env, restart. Old nonces stay invalid; old signatures stop verifying. |
| Drain | `kill -TERM <pid>` — graceful shutdown finishes in-flight requests, closes SQLite cleanly. Hard fallback after 15 s. |

## Production launch checklist

- [ ] `NODE_ENV=production` and the backend refuses to boot if you remove SIGNER_KEY.
- [ ] Signer EOA authorised at `RewardsDistributor.setSigner` and `GameRegistry.setSigner`.
- [ ] Relayer EOA authorised at `PaymentRouter.setRelayer`.
- [ ] CORS allowlist matches the production app origin (no wildcard).
- [ ] Backend is behind HTTPS with HSTS.
- [ ] `STRIPE_WEBHOOK_SECRET` matches the webhook configured at dashboard.stripe.com.
- [ ] OAuth redirect URLs registered with Discord + X dev portals: `https://api.<domain>/api/auth/{discord,twitter}/callback`.
- [ ] DB volume is on persistent storage with automated daily snapshots.
- [ ] Healthcheck monitor is alerting on `/api/health` 4xx/5xx.
- [ ] Rate limit (`RATE_LIMIT_RPS`) calibrated against expected DAU.
- [ ] Bug bounty page published (in-scope endpoint list).
