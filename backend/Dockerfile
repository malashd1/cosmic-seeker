# Multi-stage build for the CosmicSeeker backend.
#
#   Stage 1 — install dev+prod deps, compile TypeScript, produce dist/.
#   Stage 2 — slim runtime: prod deps only, runs the compiled output.
#
# The image is non-root, exposes :8787, and persists the SQLite database
# under /data (mount a volume if you want it to survive restarts).

# ─── Stage 1: build ───────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 needs a C toolchain to compile its native module.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production deps only.
RUN npm prune --omit=dev


# ─── Stage 2: runtime ─────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# better-sqlite3's native .node binary is in node_modules — runtime needs
# `libstdc++6` (already in slim) and that's all.
ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/cosmic-seeker.db

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app app \
 && mkdir -p /data && chown -R app:app /app /data

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist         ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
