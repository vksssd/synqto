// ─── Zero-Dependency Chrome Web Store ZIP Packager for Synqto ───

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(extensionRoot, 'dist');
const outputDir = path.resolve(extensionRoot, 'dist-zip');

if (!fs.existsSync(distDir)) {
  console.error('❌ Error: dist/ directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Read version from the BUILT manifest — the artifact's own declaration, not the source's.
//
// This used to default to '0.2.0.0' when dist/manifest.json was missing or lacked a version,
// which meant a broken or stale build produced a confidently mislabelled zip
// (synqto-v0.2.0.0.zip) that looked like a real release. A packaging step must never invent
// a version: the filename is how the artifact is identified after it leaves this machine.
const manifestPath = path.resolve(distDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`\n✗ cannot package: ${manifestPath} not found — run the build first.\n`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
if (!version) {
  console.error('\n✗ cannot package: dist/manifest.json has no "version" field.\n');
  process.exit(1);
}

const vParts = version.split('.');
const version4 = vParts.length >= 4 ? vParts.slice(0, 4).join('.') : `${version}.0`;
const version3 = vParts.slice(0, 3).join('.');

const zipFileName = `synqto-v${version4}.zip`;
const zipFilePath = path.resolve(outputDir, zipFileName);

if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// Compress dist contents directly into the root of the ZIP.
//
// Do not shell through `powershell -Command Compress-Archive`: Windows PowerShell and
// PowerShell 7 have different module installations, and on otherwise healthy machines the
// legacy Archive module can fail to autoload. Passing an argv array also avoids path quoting
// and command-injection bugs when a workspace contains spaces or shell metacharacters.
const isWin = process.platform === 'win32';
if (isWin) {
  // Windows 10+ ships libarchive as tar.exe; `-a` selects ZIP from the destination suffix.
  execFileSync('tar.exe', ['-a', '-c', '-f', zipFilePath, '-C', distDir, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', zipFilePath, '.'], { cwd: distDir, stdio: 'inherit' });
}

// Copy to website/downloads and root downloads
const copyTargets = [
  path.resolve(extensionRoot, '..', 'website', 'downloads'),
  path.resolve(extensionRoot, '..', 'downloads'),
];

const aliasNames = [
  `synqto-v${version4}.zip`,
  `synqto-v${version3}.zip`,
];
const latestAliases = ['synqto-latest.zip'];

for (const dir of copyTargets) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const alias of [...aliasNames, ...latestAliases]) {
    fs.copyFileSync(zipFilePath, path.resolve(dir, alias));
  }
}

// Also create aliases in dist-zip
for (const alias of [...aliasNames, ...latestAliases]) {
  fs.copyFileSync(zipFilePath, path.resolve(outputDir, alias));
}

const stats = fs.statSync(zipFilePath);
const sizeKB = (stats.size / 1024).toFixed(2);

console.log(`\n🎉 Chrome Web Store Release Package Created Successfully!`);
console.log(`📦 File: dist-zip/${zipFileName}`);
console.log(`📊 Size: ${sizeKB} KB`);
console.log(`🚀 Synced to downloads/ and website/downloads/\n`);

