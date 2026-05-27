// Generate Farcaster Frame preview image — shown in casts on Warpcast +
// Coinbase Wallet whenever someone links to basestriker.xyz.
//
// Spec: 3:2 ratio (Warpcast preferred), 1200×800 typical, brand-tinted.
// We composite the in-game screenshot on the left, big title + tagline +
// boss logo on the right.

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/malashd/Documents/auto_invoice/.claude/worktrees/sad-wilbur-ea631c/basestriker';
const SCREENSHOT = `${ROOT}/landing/screenshots/gameplay-1.png`;
const LOGO       = `${ROOT}/landing/logo.png`;
const OUT        = `${ROOT}/landing/frame-image.png`;

const W = 1200, H = 800;
const BG = '#0a0014';

// 1. Build screenshot panel on the left — fit-height crop + neon border.
const SCREEN_W = 360;
const SCREEN_H = H - 120;            // 680, leaving 60px top/bottom margin
const screenshotBuf = await sharp(SCREENSHOT)
  .resize(SCREEN_W, SCREEN_H, { fit: 'cover', position: 'center' })
  .toBuffer();

// 2. SVG overlay — title, tagline, callouts on the right side.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#00d4ff"/>
      <stop offset="1" stop-color="#ff3df0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Title -->
  <text x="500" y="200"
        font-family="'Press Start 2P', monospace, sans-serif"
        font-size="64" font-weight="700"
        fill="url(#title)" filter="url(#glow)">
    BASESTRIKER
  </text>

  <!-- Subtitle -->
  <text x="500" y="260"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="24" fill="#ab9ff2" letter-spacing="2">
    Galaxian-style arcade. Built on Base.
  </text>

  <!-- Feature bullets -->
  <text x="500" y="360" font-family="system-ui, sans-serif" font-size="22" fill="#e0e0f0">
    🎮  100 levels · 12 enemies · 10 bosses
  </text>
  <text x="500" y="400" font-family="system-ui, sans-serif" font-size="22" fill="#e0e0f0">
    💵  Pay in USDC (Base mainnet)
  </text>
  <text x="500" y="440" font-family="system-ui, sans-serif" font-size="22" fill="#e0e0f0">
    🏆  Weekly Top-10 → Soulbound NFT
  </text>

  <!-- CTA hint -->
  <rect x="500" y="540" width="380" height="70" rx="8"
        fill="#0052ff" stroke="#00d4ff" stroke-width="2"/>
  <text x="690" y="585" text-anchor="middle"
        font-family="system-ui, sans-serif" font-size="26" font-weight="700"
        fill="#ffffff">
    ▶  PLAY NOW
  </text>

  <!-- bottom credit -->
  <text x="500" y="720" font-family="system-ui, sans-serif" font-size="14"
        fill="#9a9ac0" opacity="0.7">
    basestriker.xyz · OnchainSummer · #BuildOnBase
  </text>
</svg>
`;

// 3. Boss logo small inset (top-right corner).
const logoBuf = await sharp(LOGO).resize(120, 120, { kernel: 'nearest' }).toBuffer();

// 4. Compose everything.
const out = await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  .composite([
    // Left-side screenshot
    { input: screenshotBuf, left: 60, top: 60 },
    // Subtle border around screenshot
    { input: Buffer.from(
        `<svg width="${SCREEN_W+8}" height="${SCREEN_H+8}">
           <rect x="0" y="0" width="${SCREEN_W+8}" height="${SCREEN_H+8}"
                 fill="none" stroke="#00d4ff" stroke-width="3" opacity="0.6"/>
         </svg>`),
      left: 56, top: 56 },
    // Title + bullets SVG overlay
    { input: Buffer.from(svg), left: 0, top: 0 },
    // Boss logo top-right
    { input: logoBuf, left: W - 120 - 40, top: 40 },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(OUT, out);
console.log(`✓ ${OUT}  ${W}×${H}  ${(out.length/1024).toFixed(1)} KB`);
