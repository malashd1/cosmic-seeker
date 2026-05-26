import { NETWORKS, DEFAULT_NETWORK } from '../web3/config';
import { walletAddress, currentNetwork } from '../web3/wallet';

type Metric = 'score' | 'points';

interface Row {
  rank: number;
  player: string;
  score: number;
  level: number;
  points: number;
}

export async function renderLeaderboard(root: HTMLElement, onClose: () => void) {
  root.innerHTML = '';
  root.classList.remove('hidden');

  const title = document.createElement('h2');
  title.textContent = 'LEADERBOARD';
  root.appendChild(title);

  // ── Metric tabs (SCORE / POINTS) ────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  let metric: Metric = 'score';
  const scoreBtn = document.createElement('button');
  scoreBtn.textContent = 'SCORE (week)';
  scoreBtn.classList.add('active');
  const pointsBtn = document.createElement('button');
  pointsBtn.textContent = 'POINTS (lifetime)';
  scoreBtn.onclick  = () => { if (metric !== 'score')  { metric = 'score';  syncTabs(); load(); } };
  pointsBtn.onclick = () => { if (metric !== 'points') { metric = 'points'; syncTabs(); load(); } };
  function syncTabs() {
    scoreBtn.classList.toggle('active',  metric === 'score');
    pointsBtn.classList.toggle('active', metric === 'points');
  }
  tabBar.appendChild(scoreBtn);
  tabBar.appendChild(pointsBtn);
  root.appendChild(tabBar);

  const sub = document.createElement('div');
  sub.style.fontSize = '8px';
  sub.style.color = '#9a9ac0';
  sub.textContent = 'Score: best run this week. Points: lifetime (level clears + shop purchases).';
  root.appendChild(sub);

  const tableWrap = document.createElement('div');
  tableWrap.style.width = '100%';
  tableWrap.style.maxWidth = '440px';
  tableWrap.innerHTML = '<div style="color:#9a9ac0;font-size:9px">Loading…</div>';
  root.appendChild(tableWrap);

  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.className = 'danger';
  close.onclick = () => { root.classList.add('hidden'); onClose(); };
  root.appendChild(close);

  const backendUrl = NETWORKS[currentNetwork() ?? DEFAULT_NETWORK].backendUrl;

  /** Render one table row matching either the score or points header. */
  function renderRow(t: HTMLTableElement, r: Row, isMe: boolean, m: Metric): HTMLTableRowElement {
    const tr = document.createElement('tr');
    if (isMe) tr.className = 'me';
    const playerCell = isMe ? `<strong>YOU</strong> · ${short(r.player)}` : short(r.player);
    if (m === 'points') {
      tr.innerHTML = `<td>${r.rank}</td><td>${playerCell}</td><td>${r.points.toLocaleString()}</td>`;
    } else {
      tr.innerHTML = `<td>${r.rank}</td><td>${playerCell}</td><td>${r.level}</td><td>${r.score.toLocaleString()}</td>`;
    }
    t.appendChild(tr);
    return tr;
  }

  async function load() {
    tableWrap.innerHTML = '<div style="color:#9a9ac0;font-size:9px">Loading…</div>';
    try {
      const r = await fetch(`${backendUrl}/api/leaderboard?metric=${metric}`);
      if (!r.ok) throw new Error(`http ${r.status}`);
      const rows: Row[] = await r.json();
      if (!rows.length) {
        tableWrap.innerHTML = `<div style="color:#9a9ac0;font-size:9px">No entries yet. Be the first.</div>`;
        return;
      }
      // Backend stores player addresses lowercase — compare lowercase on both sides.
      const me = walletAddress()?.toLowerCase();
      const t = document.createElement('table');
      const header = metric === 'points'
        ? `<tr><th>#</th><th>PLAYER</th><th>POINTS</th></tr>`
        : `<tr><th>#</th><th>PLAYER</th><th>LV</th><th>SCORE</th></tr>`;
      t.innerHTML = header;

      const TOP_N = 10;
      const visible = rows.slice(0, TOP_N);
      const myRowInTop = me ? visible.find((r) => r.player.toLowerCase() === me) : undefined;
      const myRowOutside = me && !myRowInTop ? rows.find((r) => r.player.toLowerCase() === me) : undefined;

      for (const r of visible) {
        renderRow(t, r, !!me && r.player.toLowerCase() === me, metric);
      }

      // "YOU" row pinned at the bottom when the connected wallet is outside
      // the visible top N. We separate it with a tiny ellipsis row so it
      // doesn't look like rank 11.
      if (myRowOutside) {
        const sep = document.createElement('tr');
        const colspan = metric === 'points' ? 3 : 4;
        sep.innerHTML = `<td colspan="${colspan}" style="text-align:center;color:#5a5a7a;font-size:9px;padding:6px 0">· · ·</td>`;
        t.appendChild(sep);
        renderRow(t, myRowOutside, true, metric);
      }

      tableWrap.innerHTML = '';
      tableWrap.appendChild(t);

      // Hint when the wallet is connected but the player isn't in the
      // leaderboard at all (no runs yet this week).
      if (me && !myRowInTop && !myRowOutside) {
        const hint = document.createElement('div');
        hint.style.cssText = 'color:#9a9ac0;font-size:8px;text-align:center;margin-top:8px';
        hint.textContent = 'Play a level — your row will appear here.';
        tableWrap.appendChild(hint);
      }
    } catch (e: any) {
      tableWrap.innerHTML = `<div style="color:#ff4860;font-size:9px">Failed: ${e.message ?? e}</div>`;
    }
  }
  await load();
}

function short(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}
