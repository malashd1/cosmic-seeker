// One-shot splash generator — crops the last boss (boss #10) from
// public/sprites/bosses.png and rasterises it onto the splash drawables
// (TWA: drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splash.png) plus
// public/splash.png (1080×2400, used by the web manifest).
//
// Replaces the previous "ship icon on purple" splash inherited from the
// classic_games keystore-mate so users see the actual cosmic-seeker boss
// art on first launch.

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/malashd/Documents/auto_invoice/.claude/worktrees/sad-wilbur-ea631c/cosmic-seeker';
const SRC  = join(ROOT, 'public', 'sprites', 'bosses.png');

// `bosses.png` is 320×128 — a 5×2 grid of 64×64 sprites. Boss #10 sits at
// (col 4, row 1) — bottom-right blue/purple king. Pull it out, then
// nearest-neighbor upscale (it's pixel art; bilinear would smudge).
const BOSS_COL = 4, BOSS_ROW = 1, CELL = 64;
const bossRaw = await sharp(SRC)
  .extract({ left: BOSS_COL * CELL, top: BOSS_ROW * CELL, width: CELL, height: CELL })
  .png()
  .toBuffer();

// Brand background — matches twa-manifest.json `backgroundColor:"#0a0014"`.
const BG = '#0a0014';

// TWA square splash (one per density). Boss occupies ~60% of width,
// centered. Bubblewrap shows this on top of the manifest backgroundColor.
const DENSITIES = [
  ['drawable-mdpi',    300],
  ['drawable-hdpi',    450],
  ['drawable-xhdpi',   600],
  ['drawable-xxhdpi',  900],
  ['drawable-xxxhdpi', 1200],
];
for (const [dir, size] of DENSITIES) {
  const bossSize = Math.round(size * 0.6);
  const boss = await sharp(bossRaw)
    .resize(bossSize, bossSize, { kernel: 'nearest' })
    .toBuffer();
  const left = Math.round((size - bossSize) / 2);
  const top  = Math.round((size - bossSize) / 2);
  const out = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: boss, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const target = join(ROOT, 'twa-cosmic', 'app', 'src', 'main', 'res', dir, 'splash.png');
  writeFileSync(target, out);
  console.log(`✓ ${dir}/splash.png  ${size}×${size}  (boss ${Math.round(bossSize)}px)`);
}

// 1080×2400 portrait splash for web manifest / any Capacitor fallback.
{
  const W = 1080, H = 2400;
  const bossSize = 720;
  const boss = await sharp(bossRaw)
    .resize(bossSize, bossSize, { kernel: 'nearest' })
    .toBuffer();
  const out = await sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite([{
      input: boss,
      left: Math.round((W - bossSize) / 2),
      // Vertically biased UP a bit so the title (if added later) has room
      // below — matches the previous splash composition.
      top: Math.round(H * 0.34),
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(ROOT, 'public', 'splash.png'), out);
  console.log(`✓ public/splash.png  ${W}×${H}`);
}

console.log('done.');
