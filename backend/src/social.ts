// Social-account linking — Discord + Twitter OAuth2 PKCE flow.
// A confirmed link unlocks social-gated missions and community perks.
// We do NOT post on behalf of the user; we only read their public identity.

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Database as SqliteDB } from 'better-sqlite3';

import { env } from './env.js';

const DISCORD_CLIENT_ID = env.discordClientId;
const DISCORD_CLIENT_SECRET = env.discordClientSecret;
const TWITTER_CLIENT_ID = env.twitterClientId;
const TWITTER_CLIENT_SECRET = env.twitterClientSecret;
const PUBLIC_BACKEND_URL = env.publicBackendUrl;
const PUBLIC_APP_URL = env.publicAppUrl;

type Platform = 'discord' | 'twitter';

// In-memory state cache for OAuth flow. {state -> {wallet, verifier, ts}}
const stateStore = new Map<string, { wallet: string; verifier: string; ts: number }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of stateStore) if (v.ts < cutoff) stateStore.delete(k);
}, 60_000).unref?.();

export function initSocialSchema(db: SqliteDB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_link (
      player TEXT NOT NULL,
      platform TEXT NOT NULL,
      social_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      PRIMARY KEY (player, platform)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS social_link_uniq ON social_link(platform, social_id);
  `);
}

function newPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isWallet(s: string): boolean {
  return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s);
}

// ---- Discord ----

export function discordStart(req: Request, res: Response) {
  const wallet = String(req.query.wallet ?? '').toLowerCase();
  if (!isWallet(wallet)) return res.status(400).send('bad_wallet');
  if (!DISCORD_CLIENT_ID) return res.status(503).send('discord_not_configured');
  const state = crypto.randomBytes(24).toString('base64url');
  const { verifier, challenge } = newPkce();
  stateStore.set(state, { wallet, verifier, ts: Date.now() });
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('redirect_uri', `${PUBLIC_BACKEND_URL}/api/auth/discord/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(302, url.toString());
}

export async function discordCallback(req: Request, res: Response, db: SqliteDB) {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const entry = stateStore.get(state);
  if (!entry || !code) return res.status(400).send('bad_state');
  stateStore.delete(state);

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${PUBLIC_BACKEND_URL}/api/auth/discord/callback`,
        code_verifier: entry.verifier,
      }),
    });
    if (!tokenRes.ok) return res.status(502).send(`discord_token_failed: ${await tokenRes.text()}`);
    const token = await tokenRes.json() as { access_token: string };

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) return res.status(502).send('discord_me_failed');
    const me = await meRes.json() as { id: string; username: string; global_name?: string };

    upsertLink(db, entry.wallet, 'discord', me.id, me.global_name ?? me.username);
    return res.redirect(302, `${PUBLIC_APP_URL}/?linked=discord`);
  } catch (e: any) {
    return res.status(500).send(`discord_error: ${e.message}`);
  }
}

// ---- Twitter (OAuth2 user-context, PKCE) ----

export function twitterStart(req: Request, res: Response) {
  const wallet = String(req.query.wallet ?? '').toLowerCase();
  if (!isWallet(wallet)) return res.status(400).send('bad_wallet');
  if (!TWITTER_CLIENT_ID) return res.status(503).send('twitter_not_configured');
  const state = crypto.randomBytes(24).toString('base64url');
  const { verifier, challenge } = newPkce();
  stateStore.set(state, { wallet, verifier, ts: Date.now() });
  const url = new URL('https://twitter.com/i/oauth2/authorize');
  url.searchParams.set('client_id', TWITTER_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'users.read tweet.read');
  url.searchParams.set('redirect_uri', `${PUBLIC_BACKEND_URL}/api/auth/twitter/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(302, url.toString());
}

export async function twitterCallback(req: Request, res: Response, db: SqliteDB) {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const entry = stateStore.get(state);
  if (!entry || !code) return res.status(400).send('bad_state');
  stateStore.delete(state);

  try {
    const basic = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: TWITTER_CLIENT_ID,
        code,
        redirect_uri: `${PUBLIC_BACKEND_URL}/api/auth/twitter/callback`,
        code_verifier: entry.verifier,
      }),
    });
    if (!tokenRes.ok) return res.status(502).send(`twitter_token_failed: ${await tokenRes.text()}`);
    const token = await tokenRes.json() as { access_token: string };

    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) return res.status(502).send('twitter_me_failed');
    const me = (await meRes.json() as any).data as { id: string; username: string; name: string };

    upsertLink(db, entry.wallet, 'twitter', me.id, me.username);
    return res.redirect(302, `${PUBLIC_APP_URL}/?linked=twitter`);
  } catch (e: any) {
    return res.status(500).send(`twitter_error: ${e.message}`);
  }
}

function upsertLink(db: SqliteDB, wallet: string, platform: Platform, socialId: string, handle: string) {
  db.prepare(`
    INSERT INTO social_link (player, platform, social_id, handle, verified_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(player, platform) DO UPDATE SET
      social_id = excluded.social_id,
      handle = excluded.handle,
      verified_at = excluded.verified_at
  `).run(wallet, platform, socialId, handle, Date.now());
}

export function getLinks(db: SqliteDB, wallet: string) {
  return db.prepare(`SELECT platform, handle, verified_at FROM social_link WHERE player=?`).all(wallet.toLowerCase());
}

export function unlinkSocial(db: SqliteDB, wallet: string, platform: Platform): boolean {
  const r = db.prepare(`DELETE FROM social_link WHERE player=? AND platform=?`).run(wallet.toLowerCase(), platform);
  return r.changes > 0;
}

export { safeEqual };
