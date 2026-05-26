# Deploy CosmicSeeker backend to `cosmic.soulview.org`

End-to-end walkthrough for getting the CosmicSeeker API up at
`https://cosmic.soulview.org` behind Caddy + Let's Encrypt, then pointing the
Android APK at it.

The server needs: Docker + Docker Compose, ports 80/443 open, and an A
record for `cosmic.soulview.org` resolving to its public IP.

---

## 1 · DNS

Create an A record (or AAAA) for `cosmic.soulview.org` pointing at the
server's public IP. Caddy will use the HTTP-01 ACME challenge on :80 to
issue the certificate, so the record must resolve **before** you `docker
compose up`.

Verify from any machine:

```bash
dig +short cosmic.soulview.org
```

Expect the server IP back.

## 2 · Push the backend to the server

From this repo on your laptop, ship the three deploy files:

```bash
cd cosmic-seeker/backend

# Replace USER@HOST with your SSH target.
ssh USER@HOST 'mkdir -p ~/cosmic-seeker'
rsync -av --exclude node_modules --exclude '*.db*' . USER@HOST:~/cosmic-seeker/
```

That copies `Dockerfile`, `docker-compose.production.yml`, `Caddyfile`, the
`src/` tree, `package.json`, and the templates.

## 3 · Configure the env file on the server

```bash
ssh USER@HOST
cd ~/cosmic-seeker
cp .env.production.template .env
# Edit .env if you want to rotate the signer key. The template already
# carries a freshly minted dev/prod keypair — fine for the testnet APK.
```

If you want a brand-new keypair (recommended for any deployment that will
hold real value), mint one on the server:

```bash
docker run --rm node:20-bookworm-slim \
  sh -c 'npm i --silent tweetnacl bs58 \
    && node --input-type=module -e "
      import nacl from \"tweetnacl\";
      import bs58 from \"bs58\";
      const kp = nacl.sign.keyPair();
      console.log(\"SIGNER_KEYPAIR_BASE58=\" + bs58.encode(kp.secretKey));
      console.log(\"# pubkey: \" + bs58.encode(kp.publicKey));"'
```

Paste the `SIGNER_KEYPAIR_BASE58=…` line into `.env`. Save the printed
pubkey — it's the claim authority the Anchor program will register.

## 4 · Boot

```bash
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f caddy   # watch the cert handshake
```

Caddy will fetch a real Let's Encrypt cert on first start (takes ~10 s).

## 5 · Smoke-test from outside the box

```bash
curl https://cosmic.soulview.org/api/health
# → {"ok":true,"signer":"…","chain":84532}
```

If `/api/health` returns 200 with a valid TLS cert, the backend is live.

## 6 · Frontend → APK pointing at the production backend

On your laptop:

```bash
cd cosmic-seeker
# The .env.production file in the repo already pins
#   VITE_BACKEND_URL_TEST=https://cosmic.soulview.org
# Rebuild the bundle and Android assets:
npm run build
npx cap sync android
( cd android && ./gradlew assembleDebug )
ls -lh android/app/build/outputs/apk/debug/app-debug.apk
```

The signed (debug) APK in `android/app/build/outputs/apk/debug/app-debug.apk`
talks to `https://cosmic.soulview.org` straight away.

> **Wallet-gated purchases** — both the shop (consumables) and the settings
> catalogue (ships / weapons) now refuse to mint inventory until a wallet is
> connected. The BUY button reads `CONNECT WALLET TO BUY` / `CONNECT WALLET`
> until the address resolves; tapping it kicks the wallet adapter flow. The
> backend rate-limits `/api/points/credit` per IP regardless.

## 7 · Rotate / decommission

- **Restart**: `docker compose -f docker-compose.production.yml restart backend`
- **Update**: `git pull && docker compose -f docker-compose.production.yml up -d --build`
- **Logs**: `docker compose -f docker-compose.production.yml logs -f backend`
- **DB backup**: `docker run --rm -v cosmic-seeker_cosmic-seeker-db:/data busybox tar czf - /data > db.tgz`

## Troubleshooting

| Symptom                                   | Most likely cause                                       |
|-------------------------------------------|----------------------------------------------------------|
| `502 Bad Gateway` from Caddy              | `backend` container failed health-check — `docker logs`. |
| `ERR_SSL` on first request                | DNS hadn't propagated when Caddy first started. Wait, then `docker compose restart caddy`. |
| `CORS error` in the WebView               | Add the exact `Origin` the WebView sends to `CORS_ALLOWLIST` in `.env`, then restart backend. |
| `[env] FATAL — SIGNER_KEYPAIR_BASE58…`    | The base58 string in `.env` is malformed; regenerate per step 3. |
