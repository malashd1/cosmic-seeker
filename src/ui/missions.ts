import { NETWORKS, DEFAULT_NETWORK } from '../web3/config';
import { walletAddress, currentNetwork } from '../web3/wallet';
import { claimRewards, type SignedScore } from '../web3/api';
import { refreshSkrBalance } from '../web3/balance';

interface MissionView {
  id: string;
  param: number;
  title: string;
  description: string;
  rewardPoints?: number;
  rewardStrk?: number;
  progress: number;
  completed: boolean;
  claimed?: boolean;
}

export async function renderMissions(root: HTMLElement, onClose: () => void) {
  root.innerHTML = '';
  root.classList.remove('hidden');

  const title = document.createElement('h2');
  title.textContent = 'DAILY MISSIONS';
  root.appendChild(title);

  const sub = document.createElement('div');
  sub.style.fontSize = '9px';
  sub.style.color = '#9a9ac0';
  sub.textContent = 'Resets every 24h · Earn POINTS on completion';
  root.appendChild(sub);

  const list = document.createElement('div');
  list.style.width = '100%';
  list.style.maxWidth = '440px';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  list.style.marginTop = '8px';
  root.appendChild(list);

  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.className = 'danger';
  close.onclick = () => { root.classList.add('hidden'); onClose(); };
  root.appendChild(close);

  const addr = walletAddress();
  if (!addr) {
    list.innerHTML = `<div style="color:#ff4860;font-size:10px;text-align:center;padding:20px">Connect a wallet to see your daily missions.</div>`;
    return;
  }
  const backendUrl = NETWORKS[currentNetwork() ?? DEFAULT_NETWORK].backendUrl;

  try {
    const r = await fetch(`${backendUrl}/api/missions/${addr}`);
    if (!r.ok) throw new Error(`http ${r.status}`);
    const data = await r.json() as { epoch: number; missions: MissionView[] };

    for (const m of data.missions) {
      const card = document.createElement('div');
      card.className = 'item';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '4px';
      card.innerHTML = `
        <div class="name" style="color:#ffd84d">${escapeHtml(m.title.toUpperCase())}</div>
        <div class="stats">${escapeHtml(m.description)}</div>
      `;
      // progress bar
      const pct = Math.min(100, Math.round((m.progress / m.param) * 100));
      const bar = document.createElement('div');
      bar.style.background = '#400';
      bar.style.height = '6px';
      bar.style.marginTop = '4px';
      bar.innerHTML = `<div style="background:#4cff7a;height:6px;width:${pct}%"></div>`;
      card.appendChild(bar);

      const pctRow = document.createElement('div');
      pctRow.style.fontSize = '8px';
      pctRow.style.color = '#9a9ac0';
      pctRow.style.display = 'flex';
      pctRow.style.justifyContent = 'space-between';
      pctRow.innerHTML = `<span>${m.progress}/${m.param}</span><span style="color:#4cff7a">+${m.rewardPoints ?? m.rewardStrk ?? 0} POINTS</span>`;
      card.appendChild(pctRow);

      const action = document.createElement('button');
      action.style.padding = '4px 8px';
      action.style.fontSize = '8px';
      action.style.minWidth = '0';
      if (m.claimed) {
        action.textContent = 'CLAIMED';
        action.disabled = true;
        action.style.opacity = '0.5';
      } else if (m.completed) {
        action.textContent = 'CLAIM REWARD';
        action.onclick = async () => {
          try {
            action.disabled = true;
            action.textContent = 'CLAIMING…';
            const cr = await fetch(`${backendUrl}/api/missions/claim`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ player: addr, missionId: m.id }),
            });
            if (!cr.ok) throw new Error(await cr.text());
            const signed = await cr.json() as SignedScore;
            // On-chain claim is best-effort — if the contracts aren't deployed
            // yet, the mission still records as claimed in the backend ledger.
            try { await claimRewards(signed); void refreshSkrBalance(); }
            catch (e: any) { console.warn('[mission] on-chain claim skipped:', e.message); }
            action.textContent = 'CLAIMED';
          } catch (e: any) {
            action.disabled = false;
            action.textContent = 'CLAIM REWARD';
            alert(`Claim failed: ${e.message ?? e}`);
          }
        };
      } else {
        action.textContent = 'IN PROGRESS';
        action.disabled = true;
        action.style.opacity = '0.5';
      }
      card.appendChild(action);

      list.appendChild(card);
    }
  } catch (e: any) {
    list.innerHTML = `<div style="color:#ff4860;font-size:10px;text-align:center;padding:20px">Backend unavailable: ${escapeHtml(e.message ?? '?')}</div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}
