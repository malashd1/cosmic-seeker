// Generate a square logo for basestriker.xyz Talent Protocol listing.
// Source: the "king" boss sprite (col 4, row 1 in public/sprites/bosses.png).
// Output: 512×512 PNG on brand-purple background, nearest-neighbor upscale
// to keep pixel-art crispness.

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SRC = '/Users/malashd/Documents/auto_invoice/.claude/worktrees/sad-wilbur-ea631c/cosmic-seeker/public/sprites/bosses.png';
const OUT = '/Users/malashd/Documents/auto_invoice/.claude/worktrees/sad-wilbur-ea631c/basestriker/landing/logo.png';

// bosses.png is 320×128 — 5×2 grid of 64×64. Last boss = col 4 row 1.
const CELL = 64;
const bossRaw = await sharp(SRC)
  .extract({ left: 4 * CELL, top: 1 * CELL, width: CELL, height: CELL })
  .png()
  .toBuffer();

const SIZE = 512;          // square logo
const BG = '#0a0014';      // basestriker brand dark
const BOSS_SIZE = Math.round(SIZE * 0.78);  // boss occupies most of frame

const boss = await sharp(bossRaw)
  .resize(BOSS_SIZE, BOSS_SIZE, { kernel: 'nearest' })
  .toBuffer();

const out = await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: BG },
})
  .composite([{
    input: boss,
    left: Math.round((SIZE - BOSS_SIZE) / 2),
    top:  Math.round((SIZE - BOSS_SIZE) / 2),
  }])
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(OUT, out);
console.log(`✓ ${OUT}  ${SIZE}×${SIZE}`);
