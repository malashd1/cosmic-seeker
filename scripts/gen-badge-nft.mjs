// Generate BaseStriker Weekly Top-10 Badge NFT images per rank.
//
// Tiers:
//   rank 1 → gold     (☼ rays, "FIRST PLACE")
//   rank 2 → silver   ("SECOND PLACE")
//   rank 3 → bronze   ("THIRD PLACE")
//   rank 4-10 → cyan  ("TOP 10 · #N")
//
// Output: 1024×1024 PNG (OpenSea standard, looks crisp in wallets).
//
// Used by:
//   - Static preview generation for the README / dApp Store screenshots
//   - Backend /api/badge/img/:weekId/:rank endpoint (re-uses this logic
//     but reads weekId from URL params)

import sharp from 'sharp';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/malashd/Documents/auto_invoice/.claude/worktrees/sad-wilbur-ea631c/basestriker';
const BOSS_SHEET = join(ROOT, '..', 'cosmic-seeker', 'public', 'sprites', 'bosses.png');
const OUT_DIR = join(ROOT, 'landing', 'badges');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 1024;
const BG = '#0a0014';

// Tier palette — primary + accent colors per rank tier.
const TIERS = {
  1: { primary: '#FFD700', accent: '#FFA500', name: 'GOLD',    label: 'FIRST PLACE'  },
  2: { primary: '#C0C0C0', accent: '#9BA3B0', name: 'SILVER',  label: 'SECOND PLACE' },
  3: { primary: '#CD7F32', accent: '#8B5A2B', name: 'BRONZE',  label: 'THIRD PLACE'  },
  // 4-10 share the cyber-cyan tier — common visual, individual rank in title.
  D: { primary: '#00d4ff', accent: '#ab9ff2', name: 'TOP-10',  label: 'TOP 10'       },
};

// Crop the king-crown boss (col 4, row 1 in 320×128 sheet of 64×64 sprites).
const CELL = 64;
const bossRaw = await sharp(BOSS_SHEET)
  .extract({ left: 4 * CELL, top: 1 * CELL, width: CELL, height: CELL })
  .png()
  .toBuffer();

function tierFor(rank) {
  if (rank <= 3) return TIERS[rank];
  return TIERS.D;
}

function rankSuffix(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Build per-badge SVG overlay (border, title, week, rank number, decorative
// rays for gold tier).
function overlaySvg(rank, weekId) {
  const t = tierFor(rank);
  const goldRays = rank === 1 ? `
    <g opacity="0.5">
      ${Array.from({length: 12}).map((_, i) => {
        const a = (i * 30) * Math.PI / 180;
        const x1 = SIZE/2 + Math.cos(a) * 220;
        const y1 = SIZE/2 + Math.sin(a) * 220;
        const x2 = SIZE/2 + Math.cos(a) * 380;
        const y2 = SIZE/2 + Math.sin(a) * 380;
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${t.primary}" stroke-width="4"/>`;
      }).join('\n      ')}
    </g>` : '';

  // Glow filter just for rank 1-3 (premium tier).
  const filter = rank <= 3 ? 'filter="url(#glow)"' : '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.primary}"/>
      <stop offset="0.5" stop-color="${t.accent}"/>
      <stop offset="1" stop-color="${t.primary}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  ${goldRays}

  <!-- Outer frame -->
  <rect x="20" y="20" width="${SIZE-40}" height="${SIZE-40}"
        fill="none" stroke="url(#border)" stroke-width="6" rx="20"/>
  <rect x="40" y="40" width="${SIZE-80}" height="${SIZE-80}"
        fill="none" stroke="${t.primary}" stroke-width="1" opacity="0.4" rx="14"/>

  <!-- Top label -->
  <text x="${SIZE/2}" y="120" text-anchor="middle"
        font-family="'Press Start 2P', monospace, sans-serif" font-size="28"
        fill="${t.primary}" ${filter} letter-spacing="6">
    BASESTRIKER
  </text>

  <text x="${SIZE/2}" y="170" text-anchor="middle"
        font-family="system-ui, sans-serif" font-size="20"
        fill="#9a9ac0" letter-spacing="4">
    WEEKLY LEADERBOARD
  </text>

  <!-- Tier badge (right under the boss area) -->
  <text x="${SIZE/2}" y="780" text-anchor="middle"
        font-family="'Press Start 2P', monospace, sans-serif" font-size="48"
        fill="${t.primary}" ${filter}>
    ${rank <= 3 ? '#' + rank : '#' + rank}
  </text>

  <text x="${SIZE/2}" y="840" text-anchor="middle"
        font-family="'Press Start 2P', monospace, sans-serif" font-size="22"
        fill="${t.primary}" ${filter} letter-spacing="3">
    ${t.label}
  </text>

  <!-- Bottom: week + tier name -->
  <text x="${SIZE/2}" y="920" text-anchor="middle"
        font-family="system-ui, sans-serif" font-size="22"
        fill="#e0e0f0" letter-spacing="2">
    WEEK ${weekId}  ·  ${t.name} TIER
  </text>

  <text x="${SIZE/2}" y="970" text-anchor="middle"
        font-family="system-ui, sans-serif" font-size="14"
        fill="#6b6b8a">
    Soulbound · ERC-721 · Base mainnet
  </text>
</svg>`;
}

// Build a single PNG for given (weekId, rank).
async function build(weekId, rank) {
  const t = tierFor(rank);
  // Boss centered, scaled — bigger for top-3 (premium tier),
  // smaller for ranks 4-10 (visually distinct).
  const bossSize = rank <= 3 ? 520 : 440;
  const boss = await sharp(bossRaw)
    .resize(bossSize, bossSize, { kernel: 'nearest' })
    .toBuffer();
  const bossLeft = Math.round((SIZE - bossSize) / 2);
  const bossTop = 220;

  const out = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: BG },
  })
    .composite([
      { input: boss, left: bossLeft, top: bossTop },
      { input: Buffer.from(overlaySvg(rank, weekId)), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return out;
}

// Sample batch — generate all 10 ranks for week 1 so we can preview.
const SAMPLE_WEEK = 1;
for (let r = 1; r <= 10; r++) {
  const buf = await build(SAMPLE_WEEK, r);
  const path = join(OUT_DIR, `week-${SAMPLE_WEEK}-rank-${r}.png`);
  writeFileSync(path, buf);
  const t = tierFor(r);
  console.log(`✓ rank ${r}  ${t.name.padEnd(7)}  ${path}`);
}

console.log(`\nAll 10 sample badges in ${OUT_DIR}`);
