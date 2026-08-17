// ─── Full Project Standalone Backup & Archive Script ───

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const backupDir = path.resolve(projectRoot, 'backups');
const parentDir = path.resolve(projectRoot, '..');

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const dateStamp = now.toISOString().slice(0, 10);
const timeStamp = now.toTimeString().slice(0, 8).replace(/:/g, '-');

const backupFileName = `synqto-project-v0.1.0-full-backup-${dateStamp}_${timeStamp}.zip`;
const backupFilePath = path.resolve(backupDir, backupFileName);
const parentBackupFilePath = path.resolve(parentDir, `synqto-project-v0.1.0-backup.zip`);

// Staging temporary folder for clean archiving without node_modules / .git
const stageDir = path.resolve(backupDir, 'stage_backup');
if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

function copyRecursiveSync(src, dest, ignoreList = ['node_modules', '.git', 'stage_backup', 'backups']) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    const base = path.basename(src);
    if (ignoreList.includes(base)) return;

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName),
        ignoreList
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('📦 Staging project files (extension, server, website, docs, release builds)...');
copyRecursiveSync(projectRoot, stageDir);

console.log('🗜️ Compressing complete project archive...');
const psCmd = `powershell -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${backupFilePath}' -Force"`;
execSync(psCmd, { stdio: 'inherit' });

// Also copy to parent directory for quick access
fs.copyFileSync(backupFilePath, parentBackupFilePath);

// Clean up staging folder
fs.rmSync(stageDir, { recursive: true, force: true });

const stats = fs.statSync(backupFilePath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
const sizeKB = (stats.size / 1024).toFixed(2);

console.log('\n======================================================');
console.log('🎉 Project Full Backup Created Successfully!');
console.log(`📁 In-Project Backup: ${backupFilePath}`);
console.log(`📁 Standalone File:   ${parentBackupFilePath}`);
console.log(`📊 Backup Size:       ${sizeMB} MB (${sizeKB} KB)`);
console.log(`📅 Timestamp:         ${now.toLocaleString()}`);
console.log('======================================================\n');
