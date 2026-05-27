import { audio } from '../game/audio';
import { SHIPS, WEAPONS } from '../game/ships';
import { POWERUP_SPECS, type PowerupKind } from '../game/powerups';
import { getPoints } from '../game/points';
import { walletAddress, connect, currentNetwork } from '../web3/wallet';
import { buyItemSkr } from '../web3/skr';
import { legalRow } from './legal';

interface SettingsCtx {
  currentShipId: string;
  currentWeaponId: string;
  setShip: (id: string) => void;
  setWeapon: (id: string) => void;
  onPurchase?: (priceSkr: number) => void;
}

const LS_KEY = 'cosmic-seeker.settings';

interface StoredSettings {
  sfxEnabled: boolean;
  musicEnabled: boolean;
  shootSfx: boolean;
  enemySfx: boolean;
  volume: number;
  shipId: string;
  weaponId: string;
}

export function loadSettings(): Partial<StoredSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<StoredSettings>;
  } catch { return {}; }
}

export function saveSettings(s: Partial<StoredSettings>) {
  const prev = loadSettings();
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...s })); } catch { /* quota or private mode */ }
}

export function applyStoredSettings(ctx: SettingsCtx) {
  const s = loadSettings();
  if (typeof s.sfxEnabled === 'boolean') audio.setEnabled(s.sfxEnabled);
  if (typeof s.musicEnabled === 'boolean') audio.setMusicEnabled(s.musicEnabled);
  if (typeof s.shootSfx === 'boolean') audio.setShootSfx(s.shootSfx);
  if (typeof s.enemySfx === 'boolean') audio.setEnemySfx(s.enemySfx);
  if (typeof s.volume === 'number') audio.setVolume(s.volume);
  // Restore equip choices only if they're still owned (free starter is always owned).
  const owned = loadOwned();
  if (s.shipId   && (s.shipId === 'scout'   || owned.ships.includes(s.shipId))) {
    ctx.currentShipId = s.shipId; ctx.setShip(s.shipId);
  }
  if (s.weaponId && (s.weaponId === 'single' || owned.weapons.includes(s.weaponId))) {
    ctx.currentWeaponId = s.weaponId; ctx.setWeapon(s.weaponId);
  }
}

export function renderSettings(root: HTMLElement, ctx: SettingsCtx, onClose: () => void) {
  root.innerHTML = '';
  root.classList.remove('hidden');

  const title = document.createElement('h2');
  title.textContent = 'SETTINGS';
  root.appendChild(title);

  const list = document.createElement('div');
  list.style.width = '100%';
  list.style.maxWidth = '440px';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '10px';
  list.style.marginTop = '10px';
  root.appendChild(list);

  // Player stats — lifetime
  list.appendChild(statsRow());

  // Audio toggles
  list.appendChild(toggleRow('All SFX', audio.enabled, (v) => {
    audio.setEnabled(v);
    saveSettings({ sfxEnabled: v });
    if (v) audio.play('menu');
  }));
  list.appendChild(toggleRow('Shot SFX (your weapon)', audio.shootSfx, (v) => {
    audio.setShootSfx(v);
    saveSettings({ shootSfx: v });
  }));
  list.appendChild(toggleRow('Enemy SFX (hits, explosions)', audio.enemySfx, (v) => {
    audio.setEnemySfx(v);
    saveSettings({ enemySfx: v });
  }));
  list.appendChild(toggleRow('Music', audio.musicEnabled, (v) => {
    audio.setMusicEnabled(v);
    saveSettings({ musicEnabled: v });
  }));

  // Volume slider
  list.appendChild(sliderRow('Master volume', audio.volume, (v) => {
    audio.setVolume(v);
    saveSettings({ volume: v });
  }));

  // Ship picker — paid: $0 / $3 / $6 / $9 / $12
  list.appendChild(purchaseRow(
    'Ship',
    ctx.currentShipId,
    SHIPS.slice(0, 5).map((s, i) => ({
      id: s.id,
      label: `${s.name} · HP${s.hp} SPD${s.speed}`,
      color: s.color,
      price: i * 15,        // SKR — 0 / 15 / 30 / 45 / 60 (½ of old $3/$6/$9/$12 USD @ 1 SKR = $0.10)
    })),
    'ships',
    (id) => {
      ctx.setShip(id);
      saveSettings({ shipId: id });
      audio.play('pickup');
    },
    (price) => ctx.onPurchase?.(price),
  ));

  // Weapon picker — paid in SKR (½ of old $3/$6/$12 USD @ 1 SKR = $0.10).
  const weaponLineup = [
    { id: 'single', price: 0 },
    { id: 'double', price: 15 },
    { id: 'triple', price: 30 },
    { id: 'spread', price: 60 },
  ];
  list.appendChild(purchaseRow(
    'Weapon',
    ctx.currentWeaponId,
    weaponLineup.map((entry) => {
      const w = WEAPONS.find((x) => x.id === entry.id)!;
      return {
        id: w.id,
        label: `${w.name} · DMG${w.damage}`,
        color: w.color,
        price: entry.price,
      };
    }),
    'weapons',
    (id) => {
      ctx.setWeapon(id);
      saveSettings({ weaponId: id });
      audio.play('pickup');
    },
    (price) => ctx.onPurchase?.(price),
  ));

  // Loot legend
  list.appendChild(lootLegendRow());

  // Legal / About — standard docs every store wants installed alongside
  // the app. Each button opens a full-screen modal with the doc text.
  list.appendChild(legalRow({
    brand:        'CosmicSeeker',
    token:        '$SKR',
    chain:        'Solana',
    supportEmail: '',
    website:      'https://cosmic.soulview.org',
    publisher:    'Chisoft',
    publisherUrl: 'https://chisoft.co',
    effectiveDate: '2026-05-20',
  }));

  // Hotkeys reference — keyboard only; on touch / narrow-viewport devices the
  // user is driving with the on-screen joystick + FIRE / BOMB buttons, so the
  // keybind list is pure noise and gets hidden.
  const isTouch = matchMedia('(pointer: coarse)').matches
    || matchMedia('(max-width: 520px)').matches
    || ('ontouchstart' in window);
  if (!isTouch) {
    const help = document.createElement('div');
    help.style.fontSize = '9px';
    help.style.color = '#9a9ac0';
    help.style.lineHeight = '1.7';
    help.style.marginTop = '6px';
    help.innerHTML = `
      <div style="color:#00d4ff">HOTKEYS</div>
      ← → ↑ ↓ / WASD &nbsp; move<br>
      Space / Z &nbsp; fire<br>
      X &nbsp; bomb<br>
      Esc &nbsp; pause/resume<br>
      M &nbsp; toggle SFX &nbsp; · &nbsp; N &nbsp; toggle music
    `;
    list.appendChild(help);
  }

  // Reset profile — wipes local progress + server leaderboard/missions
  // entries tied to the connected wallet. Useful for testing the
  // first-time experience (TRY FREE re-enables, missions reset, etc.).
  list.appendChild(resetRow());

  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.className = 'danger';
  close.style.marginTop = '8px';
  close.onclick = () => { root.classList.add('hidden'); onClose(); };
  root.appendChild(close);
}

function resetRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.style.padding = '12px 14px';
  row.innerHTML = `
    <div style="color:#ff8c1a;font-size:10px;margin-bottom:6px">RESET PROFILE</div>
    <div style="color:#9a9ac0;font-size:9px;line-height:1.6;margin-bottom:8px">
      Wipe local progress (level, points, inventory, TRY-FREE flags) and
      ask the server to remove your leaderboard / mission rows. Use this
      to test the first-time flow.
    </div>
  `;
  const btn = document.createElement('button');
  btn.textContent = 'WIPE MY DATA';
  btn.className = 'danger';
  btn.style.fontSize = '10px';
  btn.onclick = async () => {
    if (!confirm('Wipe ALL local + server progress for this wallet? This cannot be undone.')) return;
    btn.disabled = true;
    btn.textContent = 'WIPING…';
    try {
      // 1. Server side — best-effort, ok if it fails (no wallet attached).
      const addr = walletAddress();
      if (addr) {
        const net = (currentNetwork() as 'mainnet' | 'devnet') ?? 'mainnet';
        const backendUrl = (await import('../web3/config')).NETWORKS[net].backendUrl;
        try {
          await fetch(`${backendUrl}/api/player/${encodeURIComponent(addr)}/reset`, { method: 'POST' });
        } catch (e) { console.warn('[reset] server wipe failed', e); }
      }
      // 2. Local side — every namespace this build writes into localStorage.
      try {
        localStorage.removeItem('cosmic-seeker.progress');
        localStorage.removeItem('cosmic-seeker.points');
        localStorage.removeItem('cosmic-seeker.inventory');
        localStorage.removeItem('cosmic-seeker.tried-free');
        localStorage.removeItem('cosmic-seeker.owned');
        localStorage.removeItem(LS_KEY);
      } catch { /* private mode */ }
      btn.textContent = 'DONE — RELOADING…';
      setTimeout(() => location.reload(), 600);
    } catch (e: any) {
      btn.disabled = false;
      btn.textContent = `FAILED: ${String(e?.message ?? e).slice(0, 30)}`;
    }
  };
  row.appendChild(btn);
  return row;
}

function statsRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.style.padding = '14px 14px 16px';                       // breathing room around the block
  row.innerHTML = `<div style="color:#00d4ff;font-size:10px;margin-bottom:12px">YOUR STATS</div>`;
  const progress = (() => {
    try { return Number(localStorage.getItem('cosmic-seeker.progress') ?? '1') || 1; }
    catch { return 1; }
  })();
  const pts = getPoints();
  const ownedShips   = loadOwned().ships.length;
  const ownedWeapons = loadOwned().weapons.length;
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '16px 12px';                               // wider row gap, tight column gap
  grid.style.fontSize = '9px';
  grid.style.lineHeight = '1.9';
  grid.innerHTML = `
    <div>HIGHEST LV<br><strong style="color:#4cff7a;font-size:16px">${progress}</strong></div>
    <div>LIFETIME PTS<br><strong style="color:#ffd84d;font-size:16px">${pts.toLocaleString()}</strong></div>
    <div>SHIPS OWNED<br><strong style="color:#00d4ff;font-size:16px">${ownedShips + 1}/5</strong></div>
    <div>WEAPONS OWNED<br><strong style="color:#ff3df0;font-size:16px">${ownedWeapons + 1}/4</strong></div>
  `;
  row.appendChild(grid);
  return row;
}

function lootLegendRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.style.padding = '14px';
  row.innerHTML = `<div style="color:#00d4ff;font-size:11px;margin-bottom:10px">LOOT GUIDE</div>
    <div style="color:#9a9ac0;font-size:10px;line-height:1.6;margin-bottom:12px">
      Enemies drop these — fly down through the screen, walk into them to collect.
      Effect lasts until you die. Drop chance ~18%, capped per level.
    </div>`;
  // Render order — most useful first.
  const order: PowerupKind[] = ['life', 'armor', 'bomb', 'rapid', 'double', 'laser', 'plasma', 'rocket', 'points'];
  for (const kind of order) {
    const spec = POWERUP_SPECS[kind];
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.gap = '12px';
    item.style.alignItems = 'center';
    item.style.padding = '10px 0';                          // breathe between rows
    item.style.borderBottom = '1px solid #1a0028';
    item.innerHTML = `
      <span style="
        display:inline-flex; align-items:center; justify-content:center;
        width:28px; height:28px; flex-shrink:0;
        background:${spec.color}; color:#000;
        font-size:13px; font-weight:bold;
        box-shadow: 0 0 10px ${spec.color};
        clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
      ">${spec.glyph}</span>
      <div style="flex:1; min-width:0">
        <div style="color:${spec.color}; font-size:11px; line-height:1.5; margin-bottom:3px">${spec.label}</div>
        <div style="color:#fff; font-size:10px; line-height:1.6">${spec.desc}</div>
      </div>
    `;
    row.appendChild(item);
  }
  return row;
}


function toggleRow(label: string, initial: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.style.display = 'flex';
  row.style.flexDirection = 'row';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'space-between';
  row.innerHTML = `<span style="color:#00d4ff;font-size:10px">${label}</span>`;
  const btn = document.createElement('button');
  btn.style.minWidth = '90px';
  btn.style.padding = '6px 10px';
  btn.style.fontSize = '9px';
  let state = initial;
  const refresh = () => {
    btn.textContent = state ? 'ON' : 'OFF';
    btn.style.color = state ? '#4cff7a' : '#ff4860';
    btn.style.borderColor = state ? '#4cff7a' : '#ff4860';
  };
  btn.onclick = () => { state = !state; refresh(); onChange(state); };
  refresh();
  row.appendChild(btn);
  return row;
}

function sliderRow(label: string, initial: number, onChange: (v: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `<div style="color:#00d4ff;font-size:10px;margin-bottom:6px">${label}</div>`;
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0'; range.max = '1'; range.step = '0.05';
  range.value = String(initial);
  range.style.flex = '1';
  range.style.accentColor = '#00d4ff';
  const val = document.createElement('span');
  val.style.fontSize = '9px'; val.style.color = '#4cff7a'; val.style.minWidth = '32px';
  val.textContent = `${Math.round(initial * 100)}`;
  range.oninput = () => {
    const v = Number(range.value);
    val.textContent = `${Math.round(v * 100)}`;
    onChange(v);
  };
  wrap.appendChild(range); wrap.appendChild(val);
  row.appendChild(wrap);
  return row;
}

// ── owned-item ledger (per-category, persisted in localStorage) ──
type Category = 'ships' | 'weapons';
const OWNED_KEY = 'cosmic-seeker.owned';

function loadOwned(): Record<Category, string[]> {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ships:   Array.isArray(parsed.ships)   ? parsed.ships   : [],
      weapons: Array.isArray(parsed.weapons) ? parsed.weapons : [],
    };
  } catch { return { ships: [], weapons: [] }; }
}
function isOwned(cat: Category, id: string): boolean {
  const owned = loadOwned();
  return owned[cat].includes(id);
}
function markOwned(cat: Category, id: string) {
  const owned = loadOwned();
  if (!owned[cat].includes(id)) {
    owned[cat].push(id);
    try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch { /* */ }
  }
}

interface PurchaseOpt { id: string; label: string; color: string; price: number; }

/// Renders a category (Ship / Weapon) as a paid catalogue:
///   - Free items (price=0) are always equippable.
///   - Paid items show "$N SKR" until purchased, then "EQUIP".
///   - The currently-equipped item shows "EQUIPPED" (highlighted).
/// Re-renders itself on every click so state is always coherent.
function purchaseRow(
  label: string,
  currentId: string,
  options: PurchaseOpt[],
  cat: Category,
  onEquip: (id: string) => void,
  onPurchase?: (priceSkr: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `<div style="color:#00d4ff;font-size:10px;margin-bottom:6px">${label}</div>`;
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr';
  grid.style.gap = '4px';
  row.appendChild(grid);

  let equippedId = currentId;

  function render() {
    grid.innerHTML = '';
    for (const opt of options) {
      const ownedFlag = opt.price === 0 || isOwned(cat, opt.id);
      const equipped = opt.id === equippedId;

      const cell = document.createElement('div');
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.gap = '8px';
      cell.style.padding = '6px 8px';
      cell.style.border = `2px solid ${opt.color}`;
      cell.style.background = equipped ? opt.color : 'transparent';

      const name = document.createElement('span');
      name.style.flex = '1';
      name.style.fontSize = '8px';
      name.style.color = equipped ? '#000' : opt.color;
      name.textContent = opt.label;
      cell.appendChild(name);

      const action = document.createElement('button');
      action.style.minWidth = '0';
      action.style.padding = '4px 8px';
      action.style.fontSize = '8px';
      if (equipped) {
        action.textContent = 'EQUIPPED';
        action.style.color = '#000';
        action.style.background = '#fff';
        action.style.borderColor = '#000';
        action.disabled = true;
      } else if (ownedFlag) {
        action.textContent = 'EQUIP';
        action.style.color = '#4cff7a';
        action.style.borderColor = '#4cff7a';
        action.onclick = () => {
          equippedId = opt.id;
          onEquip(opt.id);
          audio.play('pickup');
          render();
        };
      } else if (!walletAddress()) {
        // Hard wallet gate: paid items only after the player connects a
        // wallet. Tapping the button kicks off the connect flow and re-
        // renders on success so the BUY label returns.
        action.textContent = 'CONNECT WALLET';
        action.style.color = '#ffd84d';
        action.style.borderColor = '#ffd84d';
        action.onclick = async () => {
          action.disabled = true;
          action.textContent = 'CONNECTING…';
          const timeoutP = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000));
          try { await Promise.race([connect(), timeoutP]); } catch { /* user dismissed */ }
          // Re-render whether connect succeeded, cancelled, or timed out.
          render();
        };
      } else {
        action.textContent = `BUY ${opt.price} SKR`;
        action.style.color = opt.color;
        action.style.borderColor = opt.color;
        action.onclick = async () => {
          // Final guard — wallet may have been disconnected between render
          // and click.
          if (!walletAddress()) { render(); return; }
          const origLabel = action.textContent;
          action.disabled = true;
          action.textContent = 'CONFIRM IN WALLET…';
          try {
            // Real on-chain SKR transfer. Only mark owned + equip after
            // the wallet confirms and the tx lands — no free items.
            const outcome = await buyItemSkr(opt.price, 1);
            if (outcome.kind === 'no-wallet') { render(); return; }
            if (outcome.kind === 'no-config') {
              throw new Error('Shop not configured — payment unavailable.');
            }
            // outcome.kind === 'tx' — payment confirmed on-chain.
            markOwned(cat, opt.id);
            onPurchase?.(opt.price);
            equippedId = opt.id;
            onEquip(opt.id);
            audio.play('connect');
            render();
          } catch (e: any) {
            console.warn('[settings] buy failed', e);
            const msg = String(e?.message ?? e).slice(0, 60);
            action.textContent = 'BUY FAILED';
            action.style.color = '#ff4860';
            action.style.borderColor = '#ff4860';
            const banner = document.createElement('div');
            banner.style.cssText = 'color:#ff4860;font-size:8px;margin-top:4px;line-height:1.4';
            banner.textContent = `Ошибка: ${msg}`;
            cell.appendChild(banner);
            setTimeout(() => { banner.remove(); action.textContent = origLabel ?? `BUY ${opt.price} SKR`; render(); }, 4000);
          } finally {
            action.disabled = false;
          }
        };
      }
      cell.appendChild(action);
      grid.appendChild(cell);
    }
  }
  render();
  return row;
}
