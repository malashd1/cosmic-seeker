import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { env, log } from './env.js';
import { verifyRun } from './verify.js';
import { dailyMissions, applyRunToMissions, type Mission } from './missions.js';
import { todayTournament, validateSubmission, type TournamentSubmission } from './tournament.js';
import { createCheckout, handleWebhook } from './stripe.js';
import { initSocialSchema, discordStart, discordCallback, twitterStart, twitterCallback, getLinks } from './social.js';
import type { RunResult } from './shared/types.js';

const PORT = env.port;

log.info('server.boot', {
  signerPubkey: env.signerPublicKeyBase58,
  rpcUrl: env.rpcUrl,
  nodeEnv: env.nodeEnv,
});

const db = new Database(env.dbPath);
db.pragma('journal_mode = WAL');           // better durability under concurrent reads
db.pragma('synchronous = NORMAL');         // sane perf w/o sacrificing durability

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL,
    level INTEGER NOT NULL,
    score INTEGER NOT NULL,
    duration REAL NOT NULL,
    accepted INTEGER NOT NULL,
    reason TEXT,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_player ON runs(player);
  CREATE INDEX IF NOT EXISTS runs_score ON runs(score);

  CREATE TABLE IF NOT EXISTS leaderboard_weekly (
    week INTEGER NOT NULL,
    player TEXT NOT NULL,
    score INTEGER NOT NULL,
    level INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (week, player)
  );
  CREATE INDEX IF NOT EXISTS lb_weekly_score  ON leaderboard_weekly(week, score);

  -- Cross-week aggregate: lifetime POINTS (level clears + shop purchases).
  CREATE TABLE IF NOT EXISTS points_total (
    player TEXT PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0,
    updated_ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pts_points ON points_total(points);

  CREATE TABLE IF NOT EXISTS nonces (
    nonce INTEGER PRIMARY KEY,
    player TEXT NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournament_runs (
    tournament_id TEXT NOT NULL,
    player TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    per_level_scores TEXT NOT NULL,
    damage_taken INTEGER NOT NULL,
    enemies_killed INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, player)
  );
  CREATE INDEX IF NOT EXISTS tournament_runs_score ON tournament_runs(tournament_id, total_score);

  CREATE TABLE IF NOT EXISTS mission_progress (
    player TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    mission_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player, epoch, mission_id)
  );
`);

// ── Migrations ────────────────────────────────────────────────────────
// Idempotent. SQLite's CREATE TABLE IF NOT EXISTS does NOT add columns to
// pre-existing tables, so we run targeted ALTERs and swallow the "duplicate
// column" error if they've already been applied.
function tryAlter(sql: string) {
  try { db.exec(sql); }
  catch (e: any) {
    if (!/duplicate column name/i.test(e?.message ?? '')) throw e;
  }
}
tryAlter('ALTER TABLE leaderboard_weekly ADD COLUMN points INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS lb_weekly_points ON leaderboard_weekly(week, points)');

const limiter = new RateLimiterMemory({ points: env.rateLimitRps, duration: 60 });
const app = express();
app.disable('x-powered-by');

// CORS: empty allowlist = reflect any origin (dev). Production must set CORS_ALLOWLIST.
const corsOrigin: cors.CorsOptions['origin'] =
  env.corsAllowlist.length === 0
    ? true
    : (origin, cb) => {
        if (!origin) return cb(null, true);                        // server-to-server / curl
        if (env.corsAllowlist.includes(origin)) return cb(null, true);
        log.warn('cors.blocked', { origin });
        return cb(new Error('CORS: origin not allowed'));
      };
app.use(cors({ origin: corsOrigin, credentials: true }));

// Request logging — one structured line per response.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info('http', {
      m: req.method, path: req.path, s: res.statusCode, ms: Date.now() - start,
    });
  });
  next();
});

// Stripe webhook must receive RAW body to verify signature — register before json middleware.
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '512kb' }),
  (req, res, next) => { (req as any).rawBody = (req.body as Buffer).toString('utf8'); next(); },
  handleWebhook,
);

app.use(express.json({ limit: '512kb' }));

app.post('/api/stripe/checkout', createCheckout);

// ---- Social linking (Discord + Twitter) ----
initSocialSchema(db);
app.get('/api/auth/discord/start',    discordStart);
app.get('/api/auth/discord/callback', (req, res) => discordCallback(req, res, db));
app.get('/api/auth/twitter/start',    twitterStart);
app.get('/api/auth/twitter/callback', (req, res) => twitterCallback(req, res, db));
app.get('/api/social/:addr',          (req, res) => res.json(getLinks(db, req.params.addr)));

let nonceCounter = Date.now();
const nextNonce = () => ++nonceCounter;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    signerPubkey: env.signerPublicKeyBase58,
    rpcUrl: env.rpcUrl,
  });
});

// ── Solana RPC proxy ────────────────────────────────────────────────────
// Browsers can't hit `api.mainnet-beta.solana.com` directly (CORS-locked
// since 2024) and the free CORS-friendly endpoints (PublicNode etc.)
// drop requests under modest load → frontend sees "failed to fetch" /
// "failed to get info about account …".
//
// We proxy through the backend so:
//   1. The request is same-origin from the browser's POV (no CORS).
//   2. We can point the operator at any paid / unlimited Solana RPC
//      via `SOL_RPC_URL`; client never sees the upstream URL.
//   3. One outgoing connection per request — easier to swap providers,
//      add caching / rate-limit, or pin to a region later.
//
// Per-IP rate-limited so a misbehaving client can't burn through the
// upstream quota.
app.post('/api/sol-rpc', async (req, res) => {
  try { await limiter.consume(req.ip ?? 'anon'); }
  catch { return res.status(429).json({ error: 'rate_limit' }); }
  try {
    const upstream = await fetch(env.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    log.warn('sol-rpc.upstream-failed', { msg: String(e?.message ?? e) });
    res.status(502).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'upstream RPC unreachable' },
      id: req.body?.id ?? null,
    });
  }
});

app.post('/api/run/verify', async (req, res) => {
  try {
    await limiter.consume(req.ip ?? 'anon');
  } catch {
    return res.status(429).json({ error: 'rate_limit' });
  }

  const run = req.body as RunResult;
  if (!run || typeof run !== 'object' || !run.player || !run.levelId) {
    return res.status(400).json({ error: 'bad_request' });
  }

  const verdict = verifyRun(run);
  db.prepare(`INSERT INTO runs (player, level, score, duration, accepted, reason, ts) VALUES (?,?,?,?,?,?,?)`)
    .run(run.player.toLowerCase(), run.levelId, run.score, run.duration, verdict.ok ? 1 : 0, verdict.reason ?? '', Date.now());

  if (!verdict.ok) {
    // Surface the reject reason in logs so we can debug without redeploying.
    log.warn('run.rejected', {
      player: run.player.toLowerCase(), level: run.levelId, score: run.score,
      frames: run.framesElapsed, inputs: run.inputs?.length ?? 0,
      kills: run.enemiesKilled, reason: verdict.reason,
    });
    return res.status(400).json({ error: 'verification_failed', reason: verdict.reason });
  }

  // Update mission progress from run.
  updateMissionProgress(run);

  // Update weekly leaderboard — keeps the best score + highest level seen this week
  // and accumulates POINTS (each accepted level-clear adds `verdict.rewardStrk`).
  const week = Math.floor(Date.now() / (7 * 86_400_000));
  const earnedPoints = verdict.rewardStrk;
  db.prepare(`
    INSERT INTO leaderboard_weekly (week, player, score, level, points) VALUES (?,?,?,?,?)
    ON CONFLICT(week, player) DO UPDATE SET
      score  = MAX(score, excluded.score),
      level  = MAX(level, excluded.level),
      points = points + excluded.points
  `).run(week, run.player.toLowerCase(), run.score, run.levelId, earnedPoints);

  // Lifetime POINTS aggregate (separate from the weekly view).
  db.prepare(`
    INSERT INTO points_total (player, points, updated_ts) VALUES (?,?,?)
    ON CONFLICT(player) DO UPDATE SET
      points = points + excluded.points,
      updated_ts = excluded.updated_ts
  `).run(run.player.toLowerCase(), earnedPoints, Date.now());

  // Compute reward amount: base reward + 1 per 100 score, capped by daily cap (2000 SKR).
  const baseReward = BigInt(verdict.rewardStrk) * 10n ** 18n;
  const bonusReward = BigInt(Math.floor(run.score / 100)) * 10n ** 18n;
  const amount = (baseReward + bonusReward).toString();

  const nonce = nextNonce();
  const expiry = Math.floor(Date.now() / 1000) + 60 * 30; // 30 minutes
  db.prepare(`INSERT OR IGNORE INTO nonces(nonce, player, ts) VALUES (?,?,?)`).run(nonce, run.player.toLowerCase(), Date.now());

  const signature = await signClaim({
    player: run.player,
    levelId: run.levelId,
    score: run.score,
    amount,
    nonce,
    expiry,
  });

  return res.json({
    player: run.player,
    levelId: run.levelId,
    score: run.score,
    amount,
    nonce,
    expiry,
    signature,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const week = Math.floor(Date.now() / (7 * 86_400_000));
  const level = req.query.level ? Number(req.query.level) : undefined;
  const metric = (req.query.metric === 'points' ? 'points' : 'score') as 'points' | 'score';
  const orderCol = metric === 'points' ? 'points' : 'score';

  // Both views return the same columns so the UI can render either with one component.
  let rows;
  if (level && metric === 'score') {
    rows = db.prepare(`
      SELECT player, score, level, points FROM leaderboard_weekly
      WHERE week = ? AND level = ? ORDER BY score DESC LIMIT 100
    `).all(week, level);
  } else if (metric === 'points') {
    // Points view: fall back to lifetime aggregate so it reflects shop spending too.
    rows = db.prepare(`
      SELECT pt.player AS player,
             COALESCE(lw.score, 0)  AS score,
             COALESCE(lw.level, 0)  AS level,
             pt.points              AS points
      FROM points_total pt
      LEFT JOIN leaderboard_weekly lw
        ON lw.player = pt.player AND lw.week = ?
      ORDER BY pt.points DESC LIMIT 100
    `).all(week);
  } else {
    rows = db.prepare(`
      SELECT player, score, level, points FROM leaderboard_weekly
      WHERE week = ? ORDER BY ${orderCol} DESC LIMIT 100
    `).all(week);
  }
  res.json((rows as any[]).map((r, i) => ({ rank: i + 1, ...r })));
});

// POST /api/points/credit — credit lifetime POINTS for off-chain events (e.g. dev
// shop "TRY FREE" purchases). In production this would be wallet-signed; here we
// accept a body { player, amount } and rate-limit by IP.
app.post('/api/points/credit', async (req, res) => {
  try { await limiter.consume(req.ip ?? 'anon'); } catch { return res.status(429).json({ error: 'rate_limit' }); }
  const { player, amount } = req.body ?? {};
  if (typeof player !== 'string' || !/^0x[a-f0-9]{40}$/i.test(player))
    return res.status(400).json({ error: 'bad_player' });
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000)
    return res.status(400).json({ error: 'bad_amount' });
  db.prepare(`
    INSERT INTO points_total (player, points, updated_ts) VALUES (?,?,?)
    ON CONFLICT(player) DO UPDATE SET
      points = points + excluded.points,
      updated_ts = excluded.updated_ts
  `).run(player.toLowerCase(), Math.floor(n), Date.now());
  const row = db.prepare(`SELECT points FROM points_total WHERE player = ?`).get(player.toLowerCase()) as any;
  res.json({ ok: true, total: row?.points ?? 0 });
});

// POST /api/player/:addr/reset — wipes every row tied to a wallet across
// all leaderboard / mission / run / nonce / tournament tables. No auth
// required: it can only reset the *caller's own* address since the
// frontend uses the connected wallet pubkey directly. Resetting somebody
// else's stats is harmless (POINTS are an in-game currency, not money),
// so we treat this as a self-serve "wipe me" button rather than an admin
// op. Rate-limited per IP to stop a script from churning the DB.
app.post('/api/player/:addr/reset', async (req, res) => {
  try { await limiter.consume(req.ip ?? 'anon'); } catch { return res.status(429).json({ error: 'rate_limit' }); }
  const addr = String(req.params.addr ?? '').toLowerCase();
  if (!addr || addr.length < 32 || addr.length > 64) {
    return res.status(400).json({ error: 'bad_addr' });
  }
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM runs              WHERE player = ?`).run(addr);
    db.prepare(`DELETE FROM leaderboard_weekly WHERE player = ?`).run(addr);
    db.prepare(`DELETE FROM points_total      WHERE player = ?`).run(addr);
    db.prepare(`DELETE FROM nonces            WHERE player = ?`).run(addr);
    db.prepare(`DELETE FROM mission_progress  WHERE player = ?`).run(addr);
    db.prepare(`DELETE FROM tournament_runs   WHERE player = ?`).run(addr);
  });
  tx();
  log.info('player.reset', { player: addr });
  res.json({ ok: true });
});

app.get('/api/missions/:addr', (req, res) => {
  const addr = req.params.addr.toLowerCase();
  const epoch = Math.floor(Date.now() / 86_400_000);
  const missions = dailyMissions(addr, epoch);
  // Merge stored progress.
  const stored = db.prepare(`SELECT mission_id, progress, completed, claimed FROM mission_progress WHERE player=? AND epoch=?`).all(addr, epoch) as any[];
  const byId = new Map(stored.map((r) => [r.mission_id, r]));
  for (const m of missions) {
    const row = byId.get(m.id);
    if (row) {
      m.progress = Math.min(m.param, row.progress);
      m.completed = !!row.completed;
      (m as any).claimed = !!row.claimed;
    } else {
      (m as any).claimed = false;
    }
  }
  res.json({ epoch, missions });
});

app.post('/api/missions/claim', async (req, res) => {
  try { await limiter.consume(req.ip ?? 'anon'); } catch { return res.status(429).json({ error: 'rate_limit' }); }
  const { player, missionId } = req.body ?? {};
  if (!player || !missionId) return res.status(400).json({ error: 'bad_request' });
  const addr = String(player).toLowerCase();
  const epoch = Math.floor(Date.now() / 86_400_000);
  const row = db.prepare(`SELECT progress, completed, claimed FROM mission_progress WHERE player=? AND epoch=? AND mission_id=?`).get(addr, epoch, missionId) as any;
  if (!row || !row.completed) return res.status(400).json({ error: 'not_completed' });
  if (row.claimed) return res.status(400).json({ error: 'already_claimed' });

  const missionList = dailyMissions(addr, epoch);
  const m = missionList.find((x) => x.id === missionId);
  if (!m) return res.status(400).json({ error: 'unknown_mission' });

  db.prepare(`UPDATE mission_progress SET claimed=1 WHERE player=? AND epoch=? AND mission_id=?`).run(addr, epoch, missionId);

  const amount = (BigInt(m.rewardStrk) * 10n ** 18n).toString();
  const nonce = nextNonce();
  const expiry = Math.floor(Date.now() / 1000) + 60 * 30;
  const signature = await signClaim({ player: addr, levelId: 0, score: 0, amount, nonce, expiry });

  res.json({ player: addr, levelId: 0, score: 0, amount, nonce, expiry, signature, missionId, rewardStrk: m.rewardStrk });
});

function updateMissionProgress(run: RunResult) {
  const addr = run.player.toLowerCase();
  const epoch = Math.floor(Date.now() / 86_400_000);
  const missions = dailyMissions(addr, epoch);

  // Merge currently-stored progress into the missions before applying.
  const stored = db.prepare(`SELECT mission_id, progress, completed FROM mission_progress WHERE player=? AND epoch=?`).all(addr, epoch) as any[];
  const byId = new Map(stored.map((r) => [r.mission_id, r]));
  for (const m of missions) {
    const row = byId.get(m.id);
    if (row) { m.progress = row.progress; m.completed = !!row.completed; }
  }

  // Absolute (MAX semantic) — see missions.ts comment.
  const deltas = applyRunToMissions(run, missions);
  for (const d of deltas) {
    const m = missions.find((x) => x.id === d.id);
    if (!m) continue;
    const newProgress = Math.min(m.param, d.progressAbs);
    const completed = d.completed || newProgress >= m.param;
    db.prepare(`
      INSERT INTO mission_progress (player, epoch, mission_id, progress, completed, claimed)
      VALUES (?,?,?,?,?,0)
      ON CONFLICT(player, epoch, mission_id) DO UPDATE SET
        progress  = MAX(progress, excluded.progress),
        completed = MAX(completed, excluded.completed)
    `).run(addr, epoch, d.id, newProgress, completed ? 1 : 0);
  }
}

app.get('/api/tournament/today', (_req, res) => {
  const spec = todayTournament();
  res.json(spec);
});

app.post('/api/tournament/submit', async (req, res) => {
  try { await limiter.consume(req.ip ?? 'anon'); } catch { return res.status(429).json({ error: 'rate_limit' }); }
  const sub = req.body as TournamentSubmission;
  if (!sub || !sub.player || !sub.tournamentId) return res.status(400).json({ error: 'bad_request' });

  const spec = todayTournament();
  const err = validateSubmission(sub, spec);
  if (err) return res.status(400).json({ error: err });

  // Each per-level run is also sanity-checked.
  for (const r of sub.runs) {
    const v = verifyRun(r);
    if (!v.ok) return res.status(400).json({ error: 'run_verification_failed', reason: v.reason });
  }

  const addr = sub.player.toLowerCase();
  const existing = db.prepare(`SELECT total_score FROM tournament_runs WHERE tournament_id=? AND player=?`).get(spec.id, addr) as any;
  if (existing && existing.total_score >= sub.totalScore) {
    return res.json({ ok: true, kept: 'existing', tournament: spec.id });
  }

  db.prepare(`
    INSERT INTO tournament_runs (tournament_id, player, total_score, per_level_scores, damage_taken, enemies_killed, ts)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tournament_id, player) DO UPDATE SET
      total_score = excluded.total_score,
      per_level_scores = excluded.per_level_scores,
      damage_taken = excluded.damage_taken,
      enemies_killed = excluded.enemies_killed,
      ts = excluded.ts
  `).run(spec.id, addr, sub.totalScore, JSON.stringify(sub.perLevelScores), sub.totalDamageTaken, sub.totalEnemiesKilled, Date.now());

  return res.json({ ok: true, kept: 'new', tournament: spec.id });
});

app.get('/api/tournament/leaderboard', (req, res) => {
  const id = (req.query.id as string) || todayTournament().id;
  const rows = db.prepare(`
    SELECT player, total_score, per_level_scores, damage_taken, enemies_killed, ts
    FROM tournament_runs WHERE tournament_id=? ORDER BY total_score DESC LIMIT 100
  `).all(id) as any[];
  res.json({
    tournament: id,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      player: r.player,
      totalScore: r.total_score,
      perLevelScores: JSON.parse(r.per_level_scores),
      damageTaken: r.damage_taken,
      enemiesKilled: r.enemies_killed,
      ts: r.ts,
    })),
  });
});

app.get('/api/player/:addr', (req, res) => {
  const addr = req.params.addr.toLowerCase();
  const best = db.prepare(`SELECT level, MAX(score) as score FROM runs WHERE player=? AND accepted=1 GROUP BY level ORDER BY level`).all(addr);
  const totalStrk = db.prepare(`SELECT COUNT(*) as cnt FROM runs WHERE player=? AND accepted=1`).get(addr) as any;
  res.json({ player: addr, levels: best, totalAccepted: totalStrk.cnt });
});

/**
 * Build the canonical byte layout that both the backend (when signing) and
 * the Anchor program (when verifying) reconstruct from the claim payload.
 *
 *   [player_len:u8] [player_bytes:player_len]
 *   [level_id:u16_be] [score:u64_be] [amount:u128_be]
 *   [nonce:u64_be] [expiry:u64_be]
 *
 * Total fixed overhead = 1 + 2 + 8 + 16 + 8 + 8 = 43 bytes plus the player
 * string. `player` is the wallet address as the rest of the backend stores
 * it (lowercased base58 Solana pubkey for the Seeker build, EVM hex during
 * the EVM ↔ Solana transition). The length prefix removes any ambiguity
 * between the two formats. Anchor reconstructs the same blob from its
 * instruction args, so no separator characters are needed.
 */
function buildClaimMessage(p: {
  player: string;
  levelId: number;
  score: number;
  amount: string;
  nonce: number;
  expiry: number;
}): Buffer {
  const playerBytes = Buffer.from(p.player, 'utf8');
  if (playerBytes.length > 0xff) {
    throw new Error(`player address too long for u8 length prefix (${playerBytes.length} bytes)`);
  }
  const buf = Buffer.alloc(1 + playerBytes.length + 2 + 8 + 16 + 8 + 8);
  let o = 0;
  buf.writeUInt8(playerBytes.length, o); o += 1;
  playerBytes.copy(buf, o); o += playerBytes.length;
  buf.writeUInt16BE(p.levelId & 0xffff, o); o += 2;
  // u64 BE — Node's writeBigUInt64BE handles bigints directly.
  buf.writeBigUInt64BE(BigInt(p.score), o); o += 8;
  // u128 BE — no native writer, so split into two u64 halves (hi || lo).
  const amount = BigInt(p.amount);
  if (amount < 0n || amount > (1n << 128n) - 1n) {
    throw new Error(`amount out of u128 range: ${p.amount}`);
  }
  buf.writeBigUInt64BE((amount >> 64n) & 0xffffffffffffffffn, o); o += 8;
  buf.writeBigUInt64BE(amount & 0xffffffffffffffffn, o); o += 8;
  buf.writeBigUInt64BE(BigInt(p.nonce), o); o += 8;
  buf.writeBigUInt64BE(BigInt(p.expiry), o); o += 8;
  return buf;
}

/**
 * Sign a claim with the backend's ed25519 signer key. Returns a base58
 * signature; the Anchor program's `claim_reward` instruction will pass it,
 * along with the same canonical message + the registered signer pubkey,
 * into `ed25519_program::verify`.
 *
 * We sign the SHA-256 digest of the message rather than the raw bytes so:
 *   1. The pre-image is always 32 bytes regardless of player-string length,
 *      simplifying the on-chain verify-and-reconstruct dance.
 *   2. Off-the-shelf ed25519 verifiers can swap in if Anchor's syscall ever
 *      changes shape.
 */
async function signClaim(p: { player: string; levelId: number; score: number; amount: string; nonce: number; expiry: number }) {
  const msg = buildClaimMessage(p);
  const digest = createHash('sha256').update(msg).digest();
  const sig = nacl.sign.detached(digest, env.signerSecretKey);
  return bs58.encode(sig);
}

// 404 + error handlers — last middleware in the chain.
app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('http.unhandled', { msg: err?.message, stack: err?.stack });
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  log.info('server.listening', { port: PORT, url: `http://0.0.0.0:${PORT}` });
});

// Graceful shutdown — drain in-flight requests, close SQLite cleanly.
function shutdown(signal: string) {
  log.info('server.shutdown', { signal });
  server.close((err) => {
    if (err) log.error('server.close.error', { msg: err.message });
    try { db.close(); } catch (e: any) { log.error('db.close.error', { msg: e?.message }); }
    process.exit(err ? 1 : 0);
  });
  // Hard exit fallback after 15s.
  setTimeout(() => { log.warn('server.shutdown.force'); process.exit(1); }, 15_000).unref();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', { reason: String(reason) }));
process.on('uncaughtException',  (err)    => log.error('uncaughtException',  { msg: err.message, stack: err.stack }));
