// ─── Version drift guard ───
//
// The extension's version is declared in three places that must agree:
//
//   package.json           the npm/source version
//   public/manifest.json   what Chrome installs and displays
//   src/core/version.ts    FALLBACK_VERSION, used outside an extension context
//
// Nothing enforced that. They drifted, and the drift was invisible because the only surface
// that showed a version was a hardcoded string that matched none of them. A mismatch here is
// cheap to fix and expensive to discover in the field, so it fails the build rather than
// warning: a warning in a build log is a mismatch that ships.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`\n✗ version check failed: ${msg}\n`);
  process.exit(1);
}

const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'public', 'manifest.json');
const versionTsPath = path.join(root, 'src', 'core', 'version.ts');

for (const p of [pkgPath, manifestPath, versionTsPath]) {
  if (!fs.existsSync(p)) fail(`expected file not found: ${path.relative(root, p)}`);
}

const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const manifestVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;

const tsSource = fs.readFileSync(versionTsPath, 'utf8');
const tsMatch = tsSource.match(/FALLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!tsMatch) fail('could not find FALLBACK_VERSION in src/core/version.ts');
const tsVersion = tsMatch[1];

// Chrome requires 1-4 dot-separated integers, each 0-65535, no leading zeros beyond "0".
// Rejecting a bad shape here beats discovering it when the store rejects the upload.
const CHROME_VERSION_RE = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/;
if (!CHROME_VERSION_RE.test(manifestVersion)) {
  fail(`manifest.json version "${manifestVersion}" is not a valid Chrome extension version`);
}

const all = { 'package.json': pkgVersion, 'manifest.json': manifestVersion, 'version.ts': tsVersion };
const distinct = [...new Set(Object.values(all))];

if (distinct.length !== 1) {
  const lines = Object.entries(all).map(([k, v]) => `    ${k.padEnd(16)} ${v}`).join('\n');
  fail(`version declarations disagree:\n${lines}`);
}

console.log(`✓ version ${distinct[0]} consistent across package.json, manifest.json, version.ts`);
