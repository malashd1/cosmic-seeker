#!/usr/bin/env node
//
// Generates placeholder media for the Solana Mobile dApp Store listing.
//
//   npm run gen:dapp-store-media
//
// Emits into `dapp-store/media/`:
//   - banner.png          1200x600  (16:9 landscape banner)
//   - screenshot-1.png    1080x2400 (portrait hero + title)
//   - screenshot-2.png    1080x2400 (portrait gameplay-style mock)
//   - screenshot-3.png    1080x2400 (portrait shop / wallet mock)
//
// These are deliberately "designed placeholders" — Solana Mobile rejects the
// listing if a `screenshot` purpose has no PNG, but the operator should
// replace them with real device captures before publishing. The mocks make
// it obvious to reviewers what each screen is meant to show.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const publicDir = join(repoRoot, 'public');
const outDir = join(repoRoot, 'dapp-store', 'media');

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is required. Install it with:\n  npm i -D sharp');
  process.exit(2);
}

const iconSvgPath = join(publicDir, 'icon.svg');
if (!existsSync(iconSvgPath)) {
  console.error(`Missing ${iconSvgPath}. Run from repo root.`);
  process.exit(1);
}
const iconSvg = readFileSync(iconSvgPath);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const BG_GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#0d0524"/>
      <stop offset="100%" stop-color="#1a0a3a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#9d4dff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#9d4dff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
`;

/** Star-field flecks — deterministic so re-running the script yields the same image. */
function starsSvg(w, h, count, seed) {
  let rng = seed >>> 0;
  const next = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = Math.floor(next() * w);
    const y = Math.floor(next() * h);
    const r = next() * 1.6 + 0.4;
    const a = 0.4 + next() * 0.5;
    out += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" fill="#ffffff" opacity="${a.toFixed(2)}"/>`;
  }
  return out;
}

/** A wrapping monospace caption — single SVG <text> with manual line breaks. */
function caption(text, x, y, fontPx, color = '#ffffff', anchor = 'middle') {
  return `<text x="${x}" y="${y}" font-family="'Press Start 2P', monospace" font-size="${fontPx}" fill="${color}" text-anchor="${anchor}">${text}</text>`;
}

async function renderPortrait(name, opts) {
  const W = 1080, H = 2400;
  const stars = starsSvg(W, H, 220, opts.seed);
  // Pseudo-HUD bar at top
  const hud = `
    <rect x="40" y="80" width="${W - 80}" height="120" fill="rgba(13,5,36,0.55)" stroke="#9d4dff" stroke-opacity="0.5"/>
    <text x="80"  y="160" font-family="'Press Start 2P', monospace" font-size="36" fill="#00d4ff">SCORE ${opts.score}</text>
    <text x="${W/2}" y="160" font-family="'Press Start 2P', monospace" font-size="36" fill="#ffd84d" text-anchor="middle">PTS ${opts.pts}</text>
    <text x="${W - 80}" y="160" font-family="'Press Start 2P', monospace" font-size="36" fill="#9d4dff" text-anchor="end">LV ${opts.level}</text>
  `;
  // Centre hero icon
  const heroSize = 720;
  const heroX = (W - heroSize) / 2;
  const heroY = (H - heroSize) / 2 - 200;
  // Tagline near the bottom
  const taglineY = H - 480;
  const subY = H - 360;
  const ctaY = H - 200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BG_GRADIENT}
    ${stars}
    ${hud}
    ${caption(opts.tagline, W / 2, taglineY, 56, '#9d4dff')}
    ${caption(opts.subline,  W / 2, subY,     32, '#9ad0ff')}
    <rect x="${W/2 - 360}" y="${ctaY - 60}" width="720" height="100" fill="rgba(0,212,255,0.12)" stroke="#00d4ff" stroke-width="3"/>
    ${caption(opts.cta, W / 2, ctaY + 8, 40, '#00d4ff')}
  </svg>`;

  const base = sharp(Buffer.from(svg)).png();
  const heroLayer = await sharp(iconSvg).resize(heroSize, heroSize, { fit: 'contain' }).png().toBuffer();
  await base
    .composite([{ input: heroLayer, top: Math.round(heroY), left: Math.round(heroX) }])
    .toFile(join(outDir, name));
  console.log(`✓ ${name} ${W}×${H}`);
}

async function renderBanner() {
  const W = 1200, H = 600;
  const stars = starsSvg(W, H, 70, 0xc05ec);
  const heroSize = 380;
  const heroY = (H - heroSize) / 2;
  const heroX = 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${BG_GRADIENT}
    ${stars}
    <text x="480" y="240" font-family="'Press Start 2P', monospace" font-size="64" fill="#9d4dff">COSMIC</text>
    <text x="480" y="320" font-family="'Press Start 2P', monospace" font-size="64" fill="#00d4ff">SEEKER</text>
    <text x="480" y="400" font-family="'Press Start 2P', monospace" font-size="22" fill="#9ad0ff">Galaxian on Solana · 100 levels</text>
    <text x="480" y="440" font-family="'Press Start 2P', monospace" font-size="22" fill="#9ad0ff">Earn $SKR via Seed Vault</text>
  </svg>`;
  const base = sharp(Buffer.from(svg)).png();
  const heroLayer = await sharp(iconSvg).resize(heroSize, heroSize, { fit: 'contain' }).png().toBuffer();
  await base
    .composite([{ input: heroLayer, top: Math.round(heroY), left: Math.round(heroX) }])
    .toFile(join(outDir, 'banner.png'));
  console.log(`✓ banner.png ${W}×${H}`);
}

await renderBanner();

await renderPortrait('screenshot-1.png', {
  seed: 0xc01d, score: 12345, pts: 4200, level: 7,
  tagline: 'GALAXIAN ON SOLANA',
  subline: '100 LEVELS · 12 ENEMIES · 10 BOSSES',
  cta: 'PRESS START',
});

await renderPortrait('screenshot-2.png', {
  seed: 0xc02f, score: 38990, pts: 12500, level: 42,
  tagline: 'EARN $SKR ON-CHAIN',
  subline: 'CLAIM REWARDS THROUGH SEED VAULT',
  cta: 'CONNECT WALLET',
});

await renderPortrait('screenshot-3.png', {
  seed: 0xc03e, score: 99999, pts: 41000, level: 100,
  tagline: 'SHOP · UPGRADE · SURVIVE',
  subline: 'EXTRA LIVES · ROCKETS · WINGMEN',
  cta: 'BUY 5× SKR',
});

console.log(`\n✔ Wrote dApp Store media into ${outDir}`);
console.log('   Replace these with real device captures before publishing.');
