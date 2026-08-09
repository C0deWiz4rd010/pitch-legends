import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const versionSource = readFileSync(new URL('../src/app/core/version.ts', import.meta.url), 'utf8');
const appVersion = versionSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

const versions = {
  package: packageJson.version,
  lock: packageLock.version,
  lockRoot: packageLock.packages?.['']?.version,
  manifest: manifest['.'],
  app: appVersion,
};
const unique = new Set(Object.values(versions));
if (unique.size !== 1 || unique.has(undefined)) {
  console.error('Version mismatch:', versions);
  process.exit(1);
}
console.log(`Pitch Legends version ${packageJson.version} is synchronized.`);
