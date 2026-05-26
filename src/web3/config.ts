// Cosmic Seeker network config — Solana, not EVM.
//
// `backendUrl`    — the score / leaderboard / mission API.
// `rpcUrl`        — Solana JSON-RPC endpoint (devnet / mainnet).
// `skrMint`       — Seeker-ecosystem $SKR SPL mint. Defaulted in source
//                   so the production build doesn't need an env var.
// `treasury`      — Cosmic Seeker treasury wallet that receives shop SKR.
// `skrDecimals`   — mint decimals; defaults to 6 (Seeker $SKR convention).
//
// All values are env-overrideable for testing.

export type NetworkName = 'mainnet' | 'devnet';

export interface NetworkConfig {
  backendUrl: string;
  rpcUrl: string;
  skrMint: string;
  treasury: string;
  skrDecimals: number;
}

/** Seeker ecosystem $SKR SPL mint on Solana mainnet (decimals = 6, supply
 *  ~10.3M). Same flow as basestriker's USDC — the mint already exists
 *  on-chain, the game just sends `transferChecked` from buyer's SKR ATA
 *  to the treasury's SKR ATA. No custom program / deploy required. */
const SKR_MINT_DEFAULT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';

/** CosmicSeeker treasury — system wallet that receives every shop SKR
 *  purchase. Same role as basestriker's USDC treasury (`0xe569A1f…`). */
const TREASURY_DEFAULT = 'YhHxMps6i9LRcCPTErs19dEsDD3FYnN1HnDcSLQfPkA';

export const DEFAULT_NETWORK: NetworkName =
  (import.meta.env?.VITE_DEFAULT_NETWORK as NetworkName) || 'mainnet';

function defaultBackend(): string {
  if (typeof location !== 'undefined' && location.hostname) {
    // In production the frontend + backend share `cosmic.soulview.org`, with
    // /api/* proxied through Nginx — same origin, no port.
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return `${location.protocol}//${location.hostname}`;
    }
    // Dev: backend on :8790 next to Vite on :5173.
    return `${location.protocol}//${location.hostname}:8790`;
  }
  return 'http://localhost:8790';
}

function intEnv(name: string, def: number): number {
  const v = (import.meta.env as any)?.[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    backendUrl:  (import.meta.env?.VITE_BACKEND_URL as string)  || defaultBackend(),
    // Same-origin RPC proxy — backend forwards to a real Solana RPC
    // (env.rpcUrl on the server). Bypasses every browser CORS / rate-
    // limit / "failed to fetch" issue we hit going direct: official
    // mainnet 403's any browser Origin, PublicNode flakes under load,
    // and any free public endpoint will rate-limit eventually.
    rpcUrl:      (import.meta.env?.VITE_SOL_RPC as string)      || `${defaultBackend()}/api/sol-rpc`,
    skrMint:     (import.meta.env?.VITE_SKR_MINT as string)     || SKR_MINT_DEFAULT,
    treasury:    (import.meta.env?.VITE_TREASURY as string)     || TREASURY_DEFAULT,
    skrDecimals: intEnv('VITE_SKR_DECIMALS', 6),
  },
  devnet: {
    backendUrl:  (import.meta.env?.VITE_BACKEND_URL_TEST as string)  || defaultBackend(),
    rpcUrl:      (import.meta.env?.VITE_SOL_RPC_TEST as string)      || 'https://api.devnet.solana.com',
    skrMint:     (import.meta.env?.VITE_SKR_MINT_TEST as string)     || SKR_MINT_DEFAULT,
    treasury:    (import.meta.env?.VITE_TREASURY_TEST as string)     || TREASURY_DEFAULT,
    skrDecimals: intEnv('VITE_SKR_DECIMALS_TEST', 6),
  },
};

/** True iff this network has enough configured to execute on-chain shop buys. */
export function hasOnChainShop(net: NetworkName = DEFAULT_NETWORK): boolean {
  const c = NETWORKS[net];
  return !!c.skrMint && !!c.treasury;
}
