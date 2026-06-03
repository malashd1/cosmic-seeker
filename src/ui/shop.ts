// Shop — paid one-shot run upgrades.
//
//   BUY  → pick quantity, charge SKR × N, +N to INVENTORY
//   EQUIP→ move 1 from INVENTORY into the next-run state
//   TRY FREE → wallet-connected players get one free trial per item
//             (excluding Homing Rocket — it's the imba one)
//
// Inventory persists across runs and deaths; equipped state is reset on death
// (handled in Game.finalize).

import { walletAddress, connect, onAddressChange } from '../web3/wallet';
import { buyItemSkr } from '../web3/skr';
import { audio } from '../game/audio';
import { onSkrBalanceChange, refreshSkrBalance, formatSkrBalance } from '../web3/balance';
import {
  addToInventory, removeFromInventory, countOf, onInventoryChange,
  hasTriedFree, markTriedFree,
  type ShopItemId,
} from '../game/inventory';

/// Live snapshot of what the player has equipped for the next run.
export interface ShopActiveInventory {
  extraLives: number;
  armor: number;
  bombs: number;
  weaponMode: 'normal' | 'rocket' | 'homing-rocket' | 'laser' | 'plasma';
  /** Number of *live* wingmen — drops as they take hits. */
  wingmen: number;
}

export interface ShopHandlers {
  /** Apply a single unit of `id` into the live game state. Returns true if it stuck. */
  equipOne: (id: ShopItemId) => boolean;
  /** Charge SKR (no-op for now; real impl talks to PaymentRouter). Awards points and credits backend. */
  charge: (priceUsd: number) => void;
  /** Re-read inventory display (e.g. after equip). */
  getInventory: () => ShopActiveInventory;
}

interface ItemDef {
  id: ShopItemId;
  name: string;
  desc: string;
  color: string;
  skr: number;           // unit price in $SKR (Seeker native token)
  excludeFromTryFree?: true;
}

// Cosmic Seeker prices: ½ of the BaseStriker SKR values, converted at
// 1 SKR = $0.10 (so 1× old USD = 5 SKR).
const ITEMS: ItemDef[] = [
  { id: 'extra-life',    name: 'Extra Life',     desc: '+1 HP at start of next run',                                color: '#ff4860', skr: 5 },
  { id: 'armor',         name: 'Armor Plate',    desc: '+1 hit absorbed before HP loss (stacks)',                   color: '#9ad0ff', skr: 5 },
  { id: 'extra-bomb',    name: '+1 Bomb',        desc: 'Adds one screen-clearing bomb',                             color: '#ffd84d', skr: 10 },
  { id: 'rocket',        name: 'Hunter Rocket',  desc: 'AoE explosion, 35 px. -30% fire rate.',                     color: '#ff8c1a', skr: 10 },
  { id: 'homing-rocket', name: 'Homing Rocket',  desc: 'AoE + auto-tracks enemies. -50% fire rate vs. rocket.',     color: '#ff0044', skr: 45, excludeFromTryFree: true },
  { id: 'wingman',       name: 'Wingman Drone',  desc: 'Second ship at your side, mirrors your fire (stacks 2×).',  color: '#00d4ff', skr: 10 },
];

export function renderShop(
  root: HTMLElement,
  handlers: ShopHandlers,
  onClose: () => void,
) {
  root.innerHTML = '';
  root.classList.remove('hidden');

  const title = document.createElement('h2');
  title.textContent = 'SHOP';
  root.appendChild(title);

  const sub = document.createElement('div');
  sub.style.fontSize = '9px';
  sub.style.color = '#9a9ac0';
  sub.style.textAlign = 'center';
  sub.textContent = 'One-shot upgrades — last until you die';
  root.appendChild(sub);

  const hint = document.createElement('div');
  hint.style.fontSize = '8px';
  hint.style.color = '#9a9ac0';
  hint.style.textAlign = 'center';
  hint.textContent = 'Ships & weapons are in SETTINGS.';
  root.appendChild(hint);

  // ── SKR wallet balance chip ──────────────────────────────────────────
  // Lives at the top of the shop so the player sees how much SKR they
  // have BEFORE clicking BUY. Subscribed to the global balance watcher
  // (started in main.ts), so it updates after every purchase + on the
  // 30 s background refresh.
  const skrBar = document.createElement('div');
  skrBar.style.cssText = [
    'font-size:10px',
    'color:#ab9ff2',
    'text-shadow:0 0 6px #ab9ff2',
    'text-align:center',
    'padding:6px 10px',
    'margin:6px 0 4px',
    'border:1px solid rgba(171,159,242,0.4)',
    'background:rgba(171,159,242,0.06)',
    'min-width:160px',
  ].join(';');
  skrBar.textContent = '—';
  root.appendChild(skrBar);
  const offSkr = onSkrBalanceChange((state) => {
    const txt = formatSkrBalance(state);
    // Don't show "Wallet: not connected" if the HUD already says we're
    // connected — that mismatch was the root of the user-visible bug
    // ("HUD shows connected, shop says not"). In that case the SKR
    // balance is just still loading (state is 'pending' / no-wallet
    // before the first refresh fires), so display a loading marker
    // instead of falsely claiming no wallet.
    if (txt) {
      skrBar.textContent = txt;
      skrBar.style.opacity = '1';
    } else if (walletAddress()) {
      skrBar.textContent = 'SKR …';
      skrBar.style.opacity = '0.7';
    } else {
      skrBar.textContent = 'Wallet: not connected';
      skrBar.style.opacity = '0.5';
    }
  });
  // Fire one refresh on open so the chip is current the instant the
  // panel appears (the 30 s watcher might be 29 s into its cycle).
  void refreshSkrBalance();

  const grid = document.createElement('div');
  grid.className = 'shop-grid';
  root.appendChild(grid);

  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.className = 'danger';
  close.onclick = () => {
    offWallet?.();
    offSkr?.();
    root.classList.add('hidden');
    onClose();
  };
  root.appendChild(close);

  // Re-render the whole panel when the wallet (dis)connects so BUY buttons,
  // the wallet hint, and the TRY-FREE state all flip together.
  const offWallet = onAddressChange(() => {
    if (root.classList.contains('hidden')) return;
    // Tear down our own subscriptions first so they don't leak.
    offWallet?.();
    offSkr?.();
    renderShop(root, handlers, onClose);
  });

  function equippedCount(id: ShopItemId): number {
    const inv = handlers.getInventory();
    switch (id) {
      case 'extra-life':    return inv.extraLives;
      case 'armor':         return inv.armor;
      case 'extra-bomb':    return inv.bombs;
      case 'rocket':        return inv.weaponMode === 'rocket' ? 1 : 0;
      case 'homing-rocket': return inv.weaponMode === 'homing-rocket' ? 1 : 0;
      case 'wingman':       return inv.wingmen;
    }
  }

  for (const it of ITEMS) renderItem(it);

  function renderItem(it: ItemDef) {
    const card = document.createElement('div');
    card.className = 'item';
    grid.appendChild(card);

    // qty state (local to this card)
    let qty = 1;

    function refresh() {
      const inventory = countOf(it.id);
      const equipped = equippedCount(it.id);
      const total = qty * it.skr;
      const walletConnected = !!walletAddress();
      const canTryFree = walletConnected && !it.excludeFromTryFree && !hasTriedFree(it.id);

      card.innerHTML = `
        <div class="name" style="color:${it.color}">${it.name.toUpperCase()}</div>
        <div class="stats">${it.desc}</div>
        <div style="font-size:8px;display:flex;justify-content:space-between;margin-top:4px">
          <span style="color:#4cff7a">EQUIPPED: ${equipped}</span>
          <span style="color:#9ad0ff">INVENTORY: ${inventory}</span>
        </div>
      `;

      // Quantity stepper row
      const qtyRow = document.createElement('div');
      qtyRow.style.display = 'flex';
      qtyRow.style.alignItems = 'center';
      qtyRow.style.gap = '4px';
      qtyRow.style.fontSize = '8px';
      qtyRow.style.marginTop = '4px';

      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.style.minWidth = '0'; minus.style.padding = '2px 8px';
      minus.onclick = () => { qty = Math.max(1, qty - 1); refresh(); };

      const qtyLabel = document.createElement('span');
      qtyLabel.style.minWidth = '24px';
      qtyLabel.style.textAlign = 'center';
      qtyLabel.style.color = '#fff';
      qtyLabel.textContent = `${qty}×`;

      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.style.minWidth = '0'; plus.style.padding = '2px 8px';
      plus.onclick = () => { qty = Math.min(99, qty + 1); refresh(); };

      const totalLabel = document.createElement('span');
      totalLabel.style.flex = '1';
      totalLabel.style.textAlign = 'right';
      totalLabel.style.color = it.color;
      totalLabel.textContent = `${total} SKR`;

      qtyRow.appendChild(minus);
      qtyRow.appendChild(qtyLabel);
      qtyRow.appendChild(plus);
      qtyRow.appendChild(totalLabel);
      card.appendChild(qtyRow);

      // Action buttons row
      const actions = document.createElement('div');
      actions.className = 'prices';
      actions.style.marginTop = '4px';

      const buyBtn = document.createElement('button');
      if (!walletConnected) {
        // Hard gate: no wallet → no shop. Tapping the button kicks off the
        // wallet connect flow; the panel re-renders via `onAddressChange`.
        buyBtn.textContent = 'CONNECT WALLET TO BUY';
        buyBtn.style.color = '#ffd84d';
        buyBtn.style.borderColor = '#ffd84d';
        buyBtn.onclick = async () => {
          buyBtn.disabled = true;
          buyBtn.textContent = 'CONNECTING…';
          // 25-second hard deadline — on Phantom Mobile / Seeker MWA the
          // connect() promise can hang indefinitely if the wallet app
          // doesn't return control to the WebView. Without this timer
          // the whole shop locks up and the CLOSE button looks broken.
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000));
          try {
            await Promise.race([connect(), timeoutPromise]);
          } catch { /* user dismissed */ }
          if (!walletAddress()) {
            buyBtn.disabled = false;
            buyBtn.textContent = 'CONNECT FROM MENU FIRST';
            buyBtn.style.color = '#ff4860';
            buyBtn.style.borderColor = '#ff4860';
            setTimeout(refresh, 2500);
          }
        };
      } else {
        buyBtn.textContent = `BUY ${qty}×`;
        buyBtn.style.color = it.color;
        buyBtn.style.borderColor = it.color;
        buyBtn.onclick = async () => {
          // Final guard — wallet may have been disconnected between render
          // and click.
          if (!walletAddress()) { refresh(); return; }

          buyBtn.disabled = true;
          const origLabel = buyBtn.textContent;
          buyBtn.textContent = 'CONFIRM IN WALLET…';

          try {
            // 1. On-chain SPL transfer (buyer ATA → treasury ATA).
            //    `buyItemSkr` internally awaits `confirmTx`, so by the
            //    time we get `kind: 'tx'` back the transfer has already
            //    landed at the requested commitment.
            const outcome = await buyItemSkr(it.skr, qty);

            if (outcome.kind === 'no-wallet') {
              // Edge case: wallet disconnected between guard + tx build.
              refresh();
              return;
            }

            if (outcome.kind === 'no-config') {
              // Mint / treasury env vars missing — no on-chain payment was
              // attempted. Refuse to credit the boost; the player must
              // have a real on-chain transfer settle before they own the
              // item. (Should not happen in prod since SKR_MINT_DEFAULT
              // + TREASURY_DEFAULT are hardcoded; this is a safety net.)
              throw new Error('Shop not configured — payment unavailable.');
            }

            // outcome.kind === 'tx' — payment confirmed on-chain.
            console.log('[shop] buy tx', outcome.signature);

            // 2. Credit inventory + lifetime POINTS — ONLY after the
            //    on-chain transfer is confirmed. No payment → no boost.
            addToInventory(it.id, qty);
            handlers.charge(total);

            // Visible success state — flash a green "PAID +Nx ADDED"
            // banner under the button, and re-render the card so the
            // inventory counter updates from "x0" → "x1".
            buyBtn.textContent = `✓ +${qty} ADDED`;
            buyBtn.style.color = '#4cff7a';
            buyBtn.style.borderColor = '#4cff7a';
            const ok = document.createElement('div');
            ok.style.cssText = 'color:#4cff7a;font-size:8px;margin-top:4px;line-height:1.4';
            ok.textContent = `Paid ${total} SKR · tx ${outcome.signature.slice(0, 8)}…`;
            card.appendChild(ok);
            try { audio.play('connect'); } catch { /* */ }
            setTimeout(() => { ok.remove(); refresh(); }, 2500);
            return;
          } catch (e: any) {
            console.warn('[shop] buy failed', e);
            const msg = String(e?.message ?? e).slice(0, 60);
            buyBtn.textContent = 'BUY FAILED';
            buyBtn.style.color = '#ff4860';
            buyBtn.style.borderColor = '#ff4860';
            // Show the real reason in a transient banner so the player
            // doesn't have to open DevTools to find out why nothing happened.
            const banner = document.createElement('div');
            banner.style.cssText = 'color:#ff4860;font-size:8px;margin-top:4px;line-height:1.4';
            banner.textContent = `Ошибка: ${msg}`;
            card.appendChild(banner);
            setTimeout(() => {
              banner.remove();
              buyBtn.textContent = origLabel ?? `BUY ${qty}×`;
              refresh();
            }, 4000);
            return;
          } finally {
            buyBtn.disabled = false;
          }
        };
      }
      actions.appendChild(buyBtn);

      const equipBtn = document.createElement('button');
      equipBtn.textContent = 'EQUIP';
      if (inventory > 0) {
        equipBtn.style.color = '#4cff7a';
        equipBtn.style.borderColor = '#4cff7a';
        equipBtn.onclick = () => {
          if (handlers.equipOne(it.id)) removeFromInventory(it.id, 1);
        };
      } else {
        equipBtn.disabled = true;
        equipBtn.style.opacity = '0.4';
      }
      actions.appendChild(equipBtn);

      if (canTryFree) {
        const tryBtn = document.createElement('button');
        tryBtn.textContent = 'TRY FREE (×1)';
        tryBtn.style.color = '#9a9ac0';
        tryBtn.style.borderColor = '#9a9ac0';
        tryBtn.onclick = () => {
          // TRY FREE always gives exactly one unit, regardless of the
          // quantity stepper. Reset qty so the player doesn't get
          // confused by the "+ + +" display still reading 3.
          markTriedFree(it.id);
          handlers.equipOne(it.id);   // exactly one
          qty = 1;
          refresh();
        };
        actions.appendChild(tryBtn);
      }
      card.appendChild(actions);
    }

    refresh();
    // Re-render on any inventory change (other cards modify the same store).
    const off = onInventoryChange(refresh);
    card.addEventListener('DOMNodeRemovedFromDocument', () => off());
  }

  // Wallet hint
  if (!walletAddress()) {
    const note = document.createElement('div');
    note.style.fontSize = '8px';
    note.style.color = '#9a9ac0';
    note.style.textAlign = 'center';
    note.style.marginTop = '4px';
    note.textContent = 'Connect a wallet to purchase items (+ unlock TRY FREE for first-time use).';
    root.insertBefore(note, close);
  }
}
