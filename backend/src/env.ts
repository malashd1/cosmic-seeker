// Centralised, validated environment configuration.
//
// Fail-fast in production if anything critical is missing — better to refuse to
// boot than to silently sign claims with the well-known dev key on mainnet.

import nacl from 'tweetnacl';
import bs58 from 'bs58';

// Deterministic dev ed25519 keypair, derived from a fixed 32-byte seed. NEVER
// use this in production — anyone reading the source can sign claims as the
// "real" signer. Detected and rejected in the prod-boot guard below.
const DEV_ED25519_SEED = new Uint8Array(32).fill(0x42);
const DEV_ED25519_KP = nacl.sign.keyPair.fromSeed(DEV_ED25519_SEED);
const DEV_ED25519_BASE58 = bs58.encode(DEV_ED25519_KP.secretKey);

// Permanently denylisted ed25519 pubkeys. Any pubkey that was ever published
// in plaintext to a public git repo (even briefly) is treated as compromised
// forever — bots scrape pushes within seconds, and pubkeys cannot be "rotated
// back". The boot guard below refuses to start if SIGNER_KEYPAIR_BASE58
// resolves to any of these, in both dev AND prod.
//
//   4mXWAav176RnSBYKiHA1t2gwebkCbYUD1YWmnu2UaP9F
//     Was committed to backend/.env.production.template before being scrubbed.
//     History rewrite + force-push followed, but the key MUST be considered
//     burned. Never fund the address; never reuse the secret.
const BURNED_SIGNER_PUBKEYS: ReadonlySet<string> = new Set([
  '4mXWAav176RnSBYKiHA1t2gwebkCbYUD1YWmnu2UaP9F',
]);

function readBool(name: string, def = false): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

function readInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`env ${name} must be an integer; got ${v}`);
  return n;
}

function readList(name: string, def: string[] = []): string[] {
  const v = process.env[name];
  if (!v) return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export type NodeEnv = 'development' | 'production' | 'test';

export interface Env {
  nodeEnv: NodeEnv;
  port: number;
  /** Solana RPC URL — `mainnet-beta.solana.com` in prod, `devnet.solana.com` in dev. */
  rpcUrl: string;

  // Solana-native ed25519 signer keypair, base58-encoded 64-byte secret key.
  // `secretKey` is the full 64 bytes (32-byte seed || 32-byte pubkey) as tweetnacl
  // produces it. `publicKey` is the 32-byte pubkey, also exposed in base58 for
  // convenience when registering the signer with the on-chain program.
  signerSecretKey: Uint8Array;
  signerPublicKey: Uint8Array;
  signerPublicKeyBase58: string;

  corsAllowlist: string[];          // empty = allow all (dev only)
  rateLimitRps: number;
  dbPath: string;

  stripeSecretKey: string;
  stripeWebhookSecret: string;

  discordClientId: string;
  discordClientSecret: string;
  twitterClientId: string;
  twitterClientSecret: string;
  publicBackendUrl: string;
  publicAppUrl: string;
}

function fail(reason: string): never {
  console.error(`[env] FATAL — ${reason}`);
  console.error('[env] refusing to boot. See backend/.env.example for required vars.');
  process.exit(1);
}

/** Decode a base58 ed25519 secret key and validate it's 64 bytes. */
function parseEd25519SecretBase58(name: string, value: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(value);
  } catch (e: any) {
    fail(`${name} is not valid base58 (${e?.message ?? 'decode error'})`);
  }
  if (decoded.length !== 64) {
    fail(`${name} is ${decoded.length} bytes; ed25519 secret key must be 64 bytes (seed || pubkey, as @solana/web3.js Keypair.secretKey)`);
  }
  // Cross-check: re-derive the pubkey from the seed half and compare with the
  // trailing 32 bytes. Catches accidentally pasting just a seed twice, or a
  // pubkey-only blob.
  try {
    const seed = decoded.slice(0, 32);
    const derived = nacl.sign.keyPair.fromSeed(seed);
    for (let i = 0; i < 32; i++) {
      if (derived.publicKey[i] !== decoded[32 + i]) {
        fail(`${name} is malformed: pubkey half does not match seed-derived pubkey`);
      }
    }
  } catch (e: any) {
    fail(`${name} failed ed25519 sanity check: ${e?.message ?? 'derive error'}`);
  }
  return decoded;
}

export function loadEnv(): Env {
  const nodeEnv = (process.env.NODE_ENV as NodeEnv) ?? 'development';
  const isProd = nodeEnv === 'production';

  // Ed25519 signer for the Solana-native claim path.
  const signerKeypairBase58 = process.env.SIGNER_KEYPAIR_BASE58
    ?? (isProd ? '' : DEV_ED25519_BASE58);
  if (!signerKeypairBase58) fail('SIGNER_KEYPAIR_BASE58 is required (base58 64-byte ed25519 secret key)');
  const signerSecretKey = parseEd25519SecretBase58('SIGNER_KEYPAIR_BASE58', signerKeypairBase58);
  const signerPublicKey = signerSecretKey.slice(32);
  const signerPublicKeyBase58 = bs58.encode(signerPublicKey);

  // Hard-fail in BOTH dev and prod if the configured signer matches a pubkey
  // that was previously exposed. This stops anyone from accidentally re-using
  // a burned keypair lifted from git history archives.
  if (BURNED_SIGNER_PUBKEYS.has(signerPublicKeyBase58)) {
    fail(`SIGNER_KEYPAIR_BASE58 resolves to a permanently burned pubkey (${signerPublicKeyBase58}). This key was exposed publicly and must never be used again. Generate a fresh keypair with \`solana-keygen new\`.`);
  }

  if (isProd) {
    if (signerKeypairBase58 === DEV_ED25519_BASE58) fail('SIGNER_KEYPAIR_BASE58 is the well-known dev ed25519 key. Provision a real one.');
    if (!process.env.SOL_RPC_URL && !process.env.RPC_URL) fail('SOL_RPC_URL (or legacy RPC_URL) is required in production');
    if (!process.env.CORS_ALLOWLIST) fail('CORS_ALLOWLIST is required in production (comma-separated origins)');
  }

  // Prefer SOL_RPC_URL; fall back to RPC_URL for compatibility with existing
  // .env files from the EVM era. Default to Solana devnet for ergonomics.
  const rpcUrl =
    process.env.SOL_RPC_URL
    || process.env.RPC_URL
    || (isProd ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

  return {
    nodeEnv,
    port: readInt('PORT', 8787),
    rpcUrl,

    signerSecretKey,
    signerPublicKey,
    signerPublicKeyBase58,

    corsAllowlist: readList('CORS_ALLOWLIST'),
    rateLimitRps: readInt('RATE_LIMIT_RPS', 30),
    dbPath: process.env.DB_PATH ?? 'cosmic-seeker.db',

    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',

    discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    twitterClientId: process.env.TWITTER_CLIENT_ID ?? '',
    twitterClientSecret: process.env.TWITTER_CLIENT_SECRET ?? '',
    publicBackendUrl: process.env.PUBLIC_BACKEND_URL ?? `http://localhost:${readInt('PORT', 8787)}`,
    publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:5173',
  };
}

export const env = loadEnv();

/* eslint-disable no-console */
export const log = {
  info:  (msg: string, meta?: object) => console.log(JSON.stringify({ lvl: 'info',  t: new Date().toISOString(), msg, ...meta })),
  warn:  (msg: string, meta?: object) => console.warn(JSON.stringify({ lvl: 'warn',  t: new Date().toISOString(), msg, ...meta })),
  error: (msg: string, meta?: object) => console.error(JSON.stringify({ lvl: 'error', t: new Date().toISOString(), msg, ...meta })),
};
