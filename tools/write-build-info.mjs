import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync('public/build-info.json', JSON.stringify({ version, revision, builtAt: new Date().toISOString() }) + '\n');
console.log(`Build ${version} · ${revision.slice(0, 8)}`);
