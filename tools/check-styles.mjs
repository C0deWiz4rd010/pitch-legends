import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Readability guard: no text below 10 px in stylesheets or inline component styles.
// SVG artwork (crest and mini-kit glyphs) uses viewBox units and is excluded.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const excluded = ['club-crest.component.ts', 'mini-kit.component.ts'];
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!/\.(scss|ts)$/.test(name) || name.endsWith('.spec.ts') || excluded.includes(name)) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/font(?:-size)?:[^;{}'"`]*?\b(\d+(?:\.\d+)?)px/g)) {
      if (Number(match[1]) < 10) offenders.push(`${relative(root, path)}: ${match[0]}`);
    }
  }
};
walk(root);
if (offenders.length) {
  console.error(`Text below 10 px:\n${offenders.join('\n')}`);
  process.exit(1);
}
console.log('All text styles are at least 10 px.');
