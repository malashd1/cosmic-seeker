#!/usr/bin/env node
//
// Rasterise public/icon.svg + icon-foreground.svg into the Android mipmap
// PNGs the TWA shell uses. Replaces the placeholder Bubblewrap icons that
// inherited from the classic_games template.
//
//   npm run gen:twa-icons
//
// Densities follow Bubblewrap's default set:
//   mdpi   48
//   hdpi   72
//   xhdpi  96
//   xxhdpi 144
//   xxxhdpi 192
//
// Adaptive (API 26+) layout:
//   background = solid purple #0d0524 (brand colour)
//   foreground = ic_maskable (cosmic ship sprite inside the safe zone)
//
// Legacy (pre-API 26):
//   ic_launcher.png = the full SVG composited over the brand colour.

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const publicDir = join(root, 'public');
const resDir = join(root, 'twa-cosmic', 'app', 'src', 'main', 'res');

const BRAND_BG = { r: 0x0d, g: 0x05, b: 0x24, alpha: 1 };

const fullSvg = readFileSync(join(publicDir, 'icon.svg'));
const fgSvgPath = join(publicDir, 'icon-foreground.svg');
const fgSvg = existsSync(fgSvgPath) ? readFileSync(fgSvgPath) : fullSvg;

const DENSITIES = [
  { name: 'mipmap-mdpi',    px: 48 },
  { name: 'mipmap-hdpi',    px: 72 },
  { name: 'mipmap-xhdpi',   px: 96 },
  { name: 'mipmap-xxhdpi',  px: 144 },
  { name: 'mipmap-xxxhdpi', px: 192 },
];

async function writeLegacyLauncher(target, px) {
  // Legacy: brand bg + icon composited on top. Padding 12 % so the icon
  // doesn't touch the edge (better grid alignment on stock Android).
  const inset = Math.round(px * 0.12);
  const inner = px - inset * 2;
  const iconBuf = await sharp(fullSvg).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
  await sharp({
    create: { width: px, height: px, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: iconBuf, top: inset, left: inset }])
    .png()
    .toFile(target);
}

async function writeMaskable(target, px) {
  // Maskable: icon-foreground.svg (already shrunk to ~0.78 of canvas for
  // safe-zone) on a transparent background. The adaptive XML places it
  // over the brand colour at runtime; below API 26 it gets squareless'd.
  await sharp(fgSvg).resize(px, px, { fit: 'contain' }).png().toFile(target);
}

for (const d of DENSITIES) {
  const dir = join(resDir, d.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeLegacyLauncher(join(dir, 'ic_launcher.png'), d.px);
  await writeMaskable(join(dir, 'ic_maskable.png'), d.px);
  console.log(`✓ ${d.name}: ic_launcher.png + ic_maskable.png @ ${d.px}×${d.px}`);
}

console.log(`\n✔ wrote ${DENSITIES.length * 2} PNGs into ${resDir}`);
console.log('   adaptive XML at mipmap-anydpi-v26/ic_launcher.xml — make sure it');
console.log('   references @color/ic_launcher_background, not @android:color/white');
