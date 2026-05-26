// Stripe fiat-onramp handler. Two endpoints:
//   POST /api/stripe/checkout — create a checkout session for a single item
//   POST /api/stripe/webhook  — verify signature, queue a pending mint
//
// We avoid bundling the official `stripe` SDK to keep deps tiny. Stripe webhook
// signatures are verified manually with HMAC-SHA256 over `${timestamp}.${rawBody}`
// against the secret.
//
// EVM mint path (viem → PaymentRouter.relayerMint*) has been retired. The
// Solana relayer (Anchor `buy_item` invoked by the backend's signer keypair)
// hasn't shipped yet, so completed checkouts are logged + persisted to the
// `pending_mints` table for a follow-up worker to drain once the program is
// live. We still respond 200 to Stripe so it stops retrying — the mint is
// durable in our DB.

import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { env, log } from './env.js';

const STRIPE_SECRET_KEY = env.stripeSecretKey;
const STRIPE_WEBHOOK_SECRET = env.stripeWebhookSecret;

// Reuses the same SQLite file as the rest of the backend; the table is
// created on demand so we don't depend on schema migration order.
const db = new Database(env.dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_mints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id TEXT UNIQUE NOT NULL,
    wallet TEXT NOT NULL,
    item_kind TEXT NOT NULL,
    tier INTEGER,
    equipment_id INTEGER,
    external_ref TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    created_ts INTEGER NOT NULL,
    processed_ts INTEGER
  );
  CREATE INDEX IF NOT EXISTS pending_mints_state ON pending_mints(state);
`);

log.info('stripe.boot', { signerPubkey: env.signerPublicKeyBase58, mintMode: 'queued-pending-anchor' });

// ---- Checkout session ----
// Frontend hits this with { wallet, itemKind, tier|equipmentId, priceUsd }.
// We call Stripe's checkout.sessions API and return the redirect URL.
//
// Stripe REST request:
//   POST https://api.stripe.com/v1/checkout/sessions
//   Authorization: Bearer ${STRIPE_SECRET_KEY}
//   Content-Type: application/x-www-form-urlencoded
export async function createCheckout(req: Request, res: Response) {
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: 'stripe_not_configured' });
  const { wallet, itemKind, tier, equipmentId, priceUsdCents, successUrl, cancelUrl } = req.body ?? {};
  if (!wallet || typeof wallet !== 'string') return res.status(400).json({ error: 'bad_wallet' });
  if (itemKind !== 'ship' && itemKind !== 'equipment') return res.status(400).json({ error: 'bad_itemKind' });
  if (!Number.isInteger(priceUsdCents) || priceUsdCents < 100) return res.status(400).json({ error: 'bad_price' });

  const metadata: Record<string, string> = {
    wallet: wallet.toLowerCase(),
    itemKind,
  };
  if (itemKind === 'ship') metadata.tier = String(tier);
  else metadata.equipmentId = String(equipmentId);

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl ?? 'https://cosmic.soulview.org/?stripe=success');
  params.set('cancel_url',  cancelUrl  ?? 'https://cosmic.soulview.org/?stripe=cancel');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', itemKind === 'ship' ? `CosmicSeeker Ship Tier ${tier}` : `CosmicSeeker Equipment #${equipmentId}`);
  params.set('line_items[0][price_data][unit_amount]', String(priceUsdCents));
  params.set('line_items[0][quantity]', '1');
  for (const [k, v] of Object.entries(metadata)) params.set(`metadata[${k}]`, v);

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const json = await r.json() as any;
    if (!r.ok) return res.status(502).json({ error: 'stripe_create_failed', detail: json });
    return res.json({ id: json.id, url: json.url });
  } catch (e: any) {
    return res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
}

// ---- Webhook ----
// Stripe sends `Stripe-Signature: t=<ts>,v1=<sig>` headers. Verify with HMAC-SHA256.
export function verifyStripeSig(rawBody: string, sigHeader: string | undefined): boolean {
  if (!sigHeader || !STRIPE_WEBHOOK_SECRET) return false;
  const parts = sigHeader.split(',').map((p) => p.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const v1 = parts.find((p) => p[0] === 'v1')?.[1];
  if (!t || !v1) return false;
  // Protect against replay >5 min old.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (age > 300) return false;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch { return false; }
}

export async function handleWebhook(req: Request, res: Response) {
  const raw = (req as any).rawBody as string | undefined;
  if (!raw) return res.status(400).send('no_raw_body');
  if (!verifyStripeSig(raw, req.header('stripe-signature'))) return res.status(400).send('bad_sig');

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return res.status(400).send('bad_json'); }

  if (evt.type !== 'checkout.session.completed') {
    return res.status(200).send('ignored');
  }

  const session = evt.data?.object;
  const meta = session?.metadata ?? {};
  const wallet: string | undefined = meta.wallet;
  const itemKind: string | undefined = meta.itemKind;
  if (!wallet || !itemKind) return res.status(400).send('missing_meta');
  if (itemKind !== 'ship' && itemKind !== 'equipment') return res.status(400).send('bad_itemKind');

  // Use the Stripe session id as the idempotency key — INSERT OR IGNORE means
  // a retry of the same webhook is a no-op.
  const externalRef = crypto.createHash('sha256').update(session.id ?? 'unknown').digest('hex').slice(0, 64);

  try {
    db.prepare(`
      INSERT OR IGNORE INTO pending_mints
        (stripe_session_id, wallet, item_kind, tier, equipment_id, external_ref, state, created_ts)
      VALUES (?,?,?,?,?,?, 'queued', ?)
    `).run(
      session.id,
      wallet,
      itemKind,
      itemKind === 'ship' ? Number(meta.tier) : null,
      itemKind === 'equipment' ? Number(meta.equipmentId) : null,
      externalRef,
      Date.now(),
    );
    log.info('stripe.mint_queued', { wallet, itemKind, externalRef, sessionId: session.id });
    return res.status(200).send('ok');
  } catch (e: any) {
    log.error('stripe.mint_queue_failed', { msg: e?.message });
    // 500 → Stripe retries until we record the intent.
    return res.status(500).send('queue_failed');
  }
}
