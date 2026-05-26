// Dumps all 100 generated levels to JSON. Run with: npx tsx scripts/generate-levels.ts
import { writeFileSync } from 'node:fs';
import { generateAllLevels } from '../src/game/levelgen';

const all = generateAllLevels();
writeFileSync('src/levels/levels.json', JSON.stringify(all, null, 2));
console.log(`Wrote ${all.length} levels to src/levels/levels.json`);
console.log('Bosses:', all.filter((l) => l.isBoss).map((l) => `${l.id}:${l.boss}`).join(' '));
