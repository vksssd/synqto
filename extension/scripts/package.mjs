// ─── Zero-Dependency Chrome Web Store ZIP Packager for Nerd Buddy ───

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

// Read version from manifest.json
const manifestPath = path.resolve(distDir, 'manifest.json');
let version = '0.1.0';
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  version = manifest.version || '0.1.0';
}

const zipFileName = `synqto-v${version}.zip`;
const zipFilePath = path.resolve(outputDir, zipFileName);

if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// Compress dist contents directly into root of ZIP
const isWin = process.platform === 'win32';
if (isWin) {
  const psCmd = `powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipFilePath}' -Force"`;
  execSync(psCmd, { stdio: 'inherit' });
} else {
  // Use standard unix zip utility
  execSync(`cd "${distDir}" && zip -r "${zipFilePath}" .`, { stdio: 'inherit' });
}

// Copy to website/downloads and root downloads
const copyTargets = [
  path.resolve(extensionRoot, '..', 'website', 'downloads'),
  path.resolve(extensionRoot, '..', 'downloads'),
];

const aliasNames = [`synqto-v${version}.zip`, `synqme-v${version}.zip`, `nerd-buddy-v${version}.zip`];
const latestAliases = ['synqto-latest.zip', 'synqme-latest.zip', 'nerd-buddy-latest.zip'];

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

