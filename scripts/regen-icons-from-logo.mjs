#!/usr/bin/env node
// Regenerate the ANDROID LAUNCHER icons from public/logo-source.png.
//
// Scope is intentionally narrow — this script touches ONLY the
// twa-cosmic/app/src/main/res/mipmap-*/ic_launcher* PNGs. It does NOT
// rewrite public/icon-*.png, og-image.png, or splash.png; those keep
// the cosmic-seeker ship-and-invaders branding driven by `icon.svg`
// via `generate-icons.mjs`.
//
// Rationale: the BaseStriker Sovereign-boss logo (basestriker.xyz/
// logo.png) is the publisher mark we want on the device home screen,
// while cosmic-seeker's own scene icon stays on the web favicon, OG
// share card, and TWA splash.
//
// Re-run after replacing public/logo-source.png if the brand mark
// ever changes:
//
//   node scripts/regen-icons-from-logo.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const androidRes = join(here, '..', 'twa-cosmic', 'app', 'src', 'main', 'res');

const SRC = join(publicDir, 'logo-source.png');
if (!existsSync(SRC)) {
  console.error(`Missing ${SRC} — drop the source PNG there first.`);
  process.exit(1);
}
if (!existsSync(androidRes)) {
  console.error(`Missing ${androidRes} — run from a repo with the TWA project present.`);
  process.exit(1);
}
const src = readFileSync(SRC);

const BRAND_BG = '#0d0524';   // matches values/colors.xml → ic_launcher_background

const buckets = [
  { dpi: 'mdpi',    px: 108 },
  { dpi: 'hdpi',    px: 162 },
  { dpi: 'xhdpi',   px: 216 },
  { dpi: 'xxhdpi',  px: 324 },
  { dpi: 'xxxhdpi', px: 432 },
];

for (const b of buckets) {
  const dir = join(androidRes, `mipmap-${b.dpi}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Adaptive foreground — transparent canvas, logo at 66% safe zone scale.
  const fg = await sharp({
    create: { width: b.px, height: b.px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: await sharp(src)
        .resize({
          width:  Math.round(b.px * 0.66),
          height: Math.round(b.px * 0.66),
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png().toBuffer(),
      gravity: 'center',
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), fg);

  // Legacy + round — flat on brand background, logo at ~85% scale.
  const flat = await sharp({
    create: { width: b.px, height: b.px, channels: 4, background: BRAND_BG },
  })
    .composite([{
      input: await sharp(src)
        .resize({
          width:  Math.round(b.px * 0.85),
          height: Math.round(b.px * 0.85),
          fit: 'contain',
          background: BRAND_BG,
        })
        .png().toBuffer(),
      gravity: 'center',
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(dir, 'ic_launcher.png'),       flat);
  writeFileSync(join(dir, 'ic_launcher_round.png'), flat);
  console.log(`✓ mipmap-${b.dpi}/{ic_launcher_foreground,ic_launcher,ic_launcher_round}.png ${b.px}×${b.px}`);
}
