#!/usr/bin/env node
// Regenerate all icons (PWA + Android launcher) from public/logo-source.png.
//
// Use case: the user wants the APK launcher / PWA icon to match the
// pixel-art logo from basestriker.xyz/logo.png (Sovereign boss).
// `generate-icons.mjs` rasterises from SVG; this one takes the PNG as-is
// and just resizes for every target density.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const androidRes = join(here, '..', 'twa-cosmic', 'app', 'src', 'main', 'res');

const SRC = join(publicDir, 'logo-source.png');
if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}`);
  process.exit(1);
}
const src = readFileSync(SRC);

const BRAND_BG = '#0a0014';   // matches cosmic-seeker theme

// ── PWA icons ────────────────────────────────────────────────────────
const PWA_SIZES = [
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];
for (const { name, size } of PWA_SIZES) {
  const buf = await sharp(src)
    .resize({ width: size, height: size, fit: 'contain', background: BRAND_BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(publicDir, name), buf);
  console.log(`✓ public/${name} ${size}×${size}`);
}

// ── og-image ─────────────────────────────────────────────────────────
{
  const og = await sharp({
    create: { width: 1200, height: 630, channels: 4, background: BRAND_BG },
  })
    .composite([{
      input: await sharp(src)
        .resize({ width: 560, height: 560, fit: 'contain', background: BRAND_BG })
        .png().toBuffer(),
      gravity: 'center',
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(publicDir, 'og-image.png'), og);
  console.log('✓ public/og-image.png 1200×630');
}

// ── splash ───────────────────────────────────────────────────────────
{
  const splash = await sharp({
    create: { width: 1080, height: 2400, channels: 4, background: BRAND_BG },
  })
    .composite([{
      input: await sharp(src)
        .resize({ width: 720, height: 720, fit: 'contain', background: BRAND_BG })
        .png().toBuffer(),
      top: 760, left: 180,
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(publicDir, 'splash.png'), splash);
  console.log('✓ public/splash.png 1080×2400');
  const drawableDir = join(androidRes, '..', 'drawable');
  if (existsSync(drawableDir)) {
    writeFileSync(join(drawableDir, 'splash.png'), splash);
    console.log('✓ android drawable/splash.png');
  }
}

// ── Android launcher icons (adaptive + legacy) ───────────────────────
if (existsSync(androidRes)) {
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

    // Adaptive foreground: transparent canvas, logo at 66% safe zone scale.
    const fg = await sharp({
      create: { width: b.px, height: b.px, channels: 4, background: { r:0,g:0,b:0,alpha:0 } },
    })
      .composite([{
        input: await sharp(src)
          .resize({
            width:  Math.round(b.px * 0.66),
            height: Math.round(b.px * 0.66),
            fit: 'contain',
            background: { r:0,g:0,b:0,alpha:0 },
          })
          .png().toBuffer(),
        gravity: 'center',
      }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), fg);

    // Legacy + round: flat on brand background, logo at ~85% scale (legacy
    // launchers don't apply a mask, so we can fill more of the canvas).
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

    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${BRAND_BG}</color>\n</resources>\n`);
  console.log('✓ values/ic_launcher_background.xml');
}
