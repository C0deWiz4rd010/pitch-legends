// Finds visible text written directly into Angular templates instead of going through the language
// helpers (`i18n.pick(...)`, the `t` pipe or interpolated values). It counts text nodes per file and
// compares the total with tools/i18n-baseline.json, so new hard-coded text fails the check while the
// existing debt can be paid down step by step.
//
//   node tools/check-i18n.mjs            check against the baseline
//   node tools/check-i18n.mjs --update   write the current numbers as the new baseline
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/app', import.meta.url));
const baselinePath = fileURLToPath(new URL('./i18n-baseline.json', import.meta.url));
const LETTERS = /[A-Za-zÄÖÜäöüß]{3,}/;

function walk(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')) files.push(path);
  }
  return files;
}

/** Template sources: external .html files and `template:` literals of components. */
function templatesOf(path, source) {
  if (path.endsWith('.html')) return [source];
  const found = [];
  const pattern = /template:\s*`([\s\S]*?)`/g;
  let match;
  while ((match = pattern.exec(source))) found.push(match[1]);
  return found;
}

function hardcodedTexts(template) {
  const cleaned = template
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, (svg) => svg.replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, '\u0001')
    .replace(
      /@(?:if|else if|for|switch|case|default|empty|else|defer|placeholder)\b[^{]*\{/g,
      '\u0001',
    )
    .replace(/[{}]/g, '\u0001');
  return cleaned
    .split('\u0001')
    .map((text) => text.trim())
    .filter((text) => LETTERS.test(text) && !/^[A-Z0-9 ._·×:%/+\-–—|()[\]#]+$/.test(text));
}

const counts = {};
for (const path of walk(root)) {
  const source = readFileSync(path, 'utf8');
  let total = 0;
  for (const template of templatesOf(path, source)) total += hardcodedTexts(template).length;
  if (total) counts[relative(root, path).replaceAll('\\', '/')] = total;
}
const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  console.log(
    `Baseline written: ${total} hard-coded text nodes in ${Object.keys(counts).length} templates.`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error('No tools/i18n-baseline.json yet; run with --update first.');
  process.exit(1);
}
const worse = Object.entries(counts).filter(([file, count]) => count > (baseline.files[file] ?? 0));
if (worse.length) {
  console.error('New hard-coded template text (use i18n.pick or the t pipe):');
  for (const [file, count] of worse)
    console.error(`  ${file}: ${count} (baseline ${baseline.files[file] ?? 0})`);
  process.exit(1);
}
const better = baseline.total - total;
console.log(
  `i18n check passed: ${total} hard-coded text nodes${better > 0 ? ` (${better} fewer than the baseline, run --update to lock it in)` : ''}.`,
);
