#!/usr/bin/env node
// Rasterise public/icon.svg into the PNG sizes the PWA manifest references.
//
// Usage:
//   npm run gen:icons
//
// Produces:
//   public/icon-192.png   (PWA, Android)
//   public/icon-512.png   (PWA, Android maskable)
//   public/icon-180.png   (Apple touch icon)
//   public/og-image.png   (1200x630 social card; if base SVG present)
//   public/screenshot-1.png (480x640 store preview)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is required. Install it with:\n  npm i -D sharp');
  process.exit(2);
}

const svgPath = join(publicDir, 'icon.svg');
if (!existsSync(svgPath)) {
  console.error(`Missing ${svgPath}. Run from repo root.`);
  process.exit(1);
}
const svg = readFileSync(svgPath);

const TARGETS = [
  { name: 'icon-192.png',     size: 192, square: true },
  { name: 'icon-512.png',     size: 512, square: true },
  { name: 'icon-180.png',     size: 180, square: true },          // Apple touch icon
  { name: 'screenshot-1.png', size: 0,   width: 480, height: 640 }, // store screenshot, letterboxed
];

const PADDING_BG = '#0a0014';

for (const t of TARGETS) {
  const w = t.square ? t.size : t.width;
  const h = t.square ? t.size : t.height;
  const buf = await sharp(svg, { density: 384 })
    .resize({
      width: w,
      height: h,
      fit: 'contain',
      background: PADDING_BG,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(publicDir, t.name), buf);
  console.log(`✓ public/${t.name} ${w}×${h}`);
}

// Social card (OG image) — composite hero icon on a larger background.
{
  const og = await sharp({
    create: {
      width: 1200, height: 630, channels: 4,
      background: PADDING_BG,
    },
  })
  .composite([{
    input: await sharp(svg, { density: 384 }).resize({ width: 560, height: 560 }).png().toBuffer(),
    gravity: 'center',
  }])
  .png({ compressionLevel: 9 })
  .toBuffer();
  writeFileSync(join(publicDir, 'og-image.png'), og);
  console.log('✓ public/og-image.png 1200×630');
}

// ── Adaptive launcher icons (Android) ─────────────────────────────────
//
// Foreground PNG goes into res/mipmap-<dpi>/ic_launcher_foreground.png at
// five density buckets. Background colour is set via colors.xml (we drop a
// new value here). mipmap-anydpi-v26/ic_launcher{,_round}.xml already
// references @mipmap/ic_launcher_foreground + @color/ic_launcher_background.
//
// For non-adaptive legacy launchers (Android <8) we also rasterise a flat
// ic_launcher.png on the brand background so the icon doesn't look hollow.
{
  const fgSvgPath = join(publicDir, 'icon-foreground.svg');
  const androidRes = join(here, '..', 'android', 'app', 'src', 'main', 'res');
  if (existsSync(fgSvgPath) && existsSync(androidRes)) {
    const fgSvg = readFileSync(fgSvgPath);
    const buckets = [
      { dpi: 'mdpi',    px: 108 },
      { dpi: 'hdpi',    px: 162 },
      { dpi: 'xhdpi',   px: 216 },
      { dpi: 'xxhdpi',  px: 324 },
      { dpi: 'xxxhdpi', px: 432 },
    ];
    const brandBg = '#0d0524';

    for (const b of buckets) {
      // Foreground — transparent canvas, ship centred.
      const fg = await sharp(fgSvg, { density: 512 })
        .resize({ width: b.px, height: b.px, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const dir = join(androidRes, `mipmap-${b.dpi}`);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ic_launcher_foreground.png'), fg);

      // Legacy launcher — flat composite on the brand background.
      const flat = await sharp({
        create: { width: b.px, height: b.px, channels: 4, background: brandBg },
      })
      .composite([{
        input: await sharp(fgSvg, { density: 512 })
          .resize({ width: Math.round(b.px * 0.72), height: Math.round(b.px * 0.72), fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png().toBuffer(),
        gravity: 'center',
      }])
      .png({ compressionLevel: 9 })
      .toBuffer();
      writeFileSync(join(dir, 'ic_launcher.png'), flat);
      writeFileSync(join(dir, 'ic_launcher_round.png'), flat);
      console.log(`✓ mipmap-${b.dpi}/{ic_launcher_foreground,ic_launcher,ic_launcher_round}.png ${b.px}×${b.px}`);
    }

    // Patch / create colors.xml so ic_launcher_background is brand purple.
    const valuesDir = join(androidRes, 'values');
    if (!existsSync(valuesDir)) mkdirSync(valuesDir, { recursive: true });
    const colorsPath = join(valuesDir, 'ic_launcher_background.xml');
    writeFileSync(colorsPath,
      `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<resources>\n  <color name="ic_launcher_background">${brandBg}</color>\n</resources>\n`,
    );
    console.log('✓ android/.../values/ic_launcher_background.xml');
  }
}

// Splash screen — 1080×2400, Seeker portrait, dropped into the Capacitor
// Android drawable so the WebView shows it instead of a white flash on boot.
// We don't write it to public/ since it isn't fetched by the web bundle;
// instead the Android sync step copies it into android/app/src/main/res/drawable.
{
  const splash = await sharp({
    create: {
      width: 1080, height: 2400, channels: 4,
      background: '#0d0524',         // deep purple — matches Seeker brand
    },
  })
  .composite([
    // hero icon centred, sized so it occupies the upper third
    {
      input: await sharp(svg, { density: 384 })
        .resize({ width: 720, height: 720, fit: 'contain', background: '#0d0524' })
        .png().toBuffer(),
      top: 760, left: 180,            // visually centred up a touch
    },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();
  // Drop both in public/ (for any web-side reuse) and into the Android res tree
  // (the canonical home for the Capacitor splash plugin).
  writeFileSync(join(publicDir, 'splash.png'), splash);
  console.log('✓ public/splash.png 1080×2400');
  const drawableDir = join(here, '..', 'android', 'app', 'src', 'main', 'res', 'drawable');
  if (existsSync(drawableDir)) {
    writeFileSync(join(drawableDir, 'splash.png'), splash);
    console.log('✓ android/.../drawable/splash.png');
  }
}
