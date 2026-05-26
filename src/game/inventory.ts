// ── Player inventory ─────────────────────────────────────────────────
// Stack of purchased-but-not-yet-equipped items. EQUIP moves one unit out of
// inventory and into the live `Game.carried*` state for the next run.
//
// Backed by localStorage today; in production this mirrors onto the backend so
// inventory survives across devices once a wallet is connected.

const KEY = 'cosmic-seeker.inventory';

export type ShopItemId =
  | 'extra-life'
  | 'armor'
  | 'extra-bomb'
  | 'rocket'
  | 'homing-rocket'
  | 'wingman';

export type InventoryMap = Partial<Record<ShopItemId, number>>;

function load(): InventoryMap {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as InventoryMap; }
  catch { return {}; }
}
function save(inv: InventoryMap) {
  try { localStorage.setItem(KEY, JSON.stringify(inv)); } catch { /* */ }
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();
export function onInventoryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getInventory(): InventoryMap { return load(); }
export function countOf(id: ShopItemId): number { return load()[id] ?? 0; }

export function addToInventory(id: ShopItemId, n: number) {
  if (!Number.isFinite(n) || n <= 0) return;
  const inv = load();
  inv[id] = (inv[id] ?? 0) + Math.floor(n);
  save(inv);
}

export function removeFromInventory(id: ShopItemId, n = 1): boolean {
  const inv = load();
  const have = inv[id] ?? 0;
  if (have < n) return false;
  inv[id] = have - n;
  if ((inv[id] ?? 0) <= 0) delete inv[id];
  save(inv);
  return true;
}

// ── First-time TRY FREE tracking ────────────────────────────────────
const TRIED_KEY = 'cosmic-seeker.triedFree';
export function hasTriedFree(id: ShopItemId): boolean {
  try {
    const arr = JSON.parse(localStorage.getItem(TRIED_KEY) ?? '[]') as string[];
    return arr.includes(id);
  } catch { return false; }
}
export function markTriedFree(id: ShopItemId) {
  try {
    const arr = JSON.parse(localStorage.getItem(TRIED_KEY) ?? '[]') as string[];
    if (!arr.includes(id)) {
      arr.push(id);
      localStorage.setItem(TRIED_KEY, JSON.stringify(arr));
    }
  } catch { /* */ }
}
