// Solana Mobile Wallet Adapter — registration + readiness helpers.
//
// The Solana dApp Store reviewer installs the APK on a real Seeker, opens
// the TWA, and immediately taps CONNECT WALLET. If MWA hasn't finished
// registering as a Wallet Standard provider yet, `getWallets().get()` is
// empty, `connect()` fails to find a wallet, and the reviewer marks the
// submission "Solana Mobile Stack Integration Failure".
//
// To make registration deterministic:
//   1. Import everything STATICALLY (no dynamic import) — this guarantees
//      `registerMwa` is in the initial bundle and runs synchronously at
//      module evaluation, before the user can possibly tap CONNECT.
//   2. Expose `mwaReady` — a Promise that resolves once registration has
//      completed (or failed) — so callers in `wallet.ts` can `await` it
//      before falling back to "no Solana wallet detected".
//   3. Use an ABSOLUTE icon URL so the native wallet's authorization sheet
//      can fetch it without resolving relative to who-knows-what origin.

import {
  registerMwa,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-standard-mobile';

export const MWA_APP_URI  = 'https://cosmic.soulview.org';
export const MWA_APP_NAME = 'CosmicSeeker';
// MWA spec requires `icon` to be a RELATIVE URI resolved against `uri`. An
// absolute URL ("https://…/icon-512.png") makes the wallet adapter reject
// the connect with "when specified, identity.icon must be a relative URI"
// — confirmed by user report on a Seeker phone running v17.
export const MWA_APP_ICON = '/icon-512.png';

/** True once `registerMwa` has been invoked successfully. */
let _registered = false;
export function mwaRegistered(): boolean { return _registered; }

/** Resolves once registration is complete (success OR failure). Callers
 *  that need MWA — e.g. the connect button on Seeker — should `await` this
 *  before claiming "no wallet detected". */
export const mwaReady: Promise<void> = (() => {
  try {
    registerMwa({
      appIdentity: {
        name: MWA_APP_NAME,
        uri:  MWA_APP_URI,
        icon: MWA_APP_ICON,
      },
      chains: ['solana:mainnet'],
      authorizationCache: createDefaultAuthorizationCache(),
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });
    _registered = true;
    return Promise.resolve();
  } catch (e) {
    console.warn('[wallet] MWA registerMwa failed:', e);
    return Promise.resolve();
  }
})();
