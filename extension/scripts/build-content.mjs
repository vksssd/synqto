// ─── Content Script Bundler (Pure TypeScript) ───
import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');

const entryFile = path.join(extensionRoot, 'src/content/content-script.ts');
const outputFile = path.join(extensionRoot, 'dist/content/content-script.js');

console.log('Compiling content script bundle...');

// Files in dependency order
const files = [
  'src/shared/utils.ts',
  'src/features/room/room-utils.ts',
  'src/features/timer/timer.types.ts',
  'src/features/settings/fab-settings.types.ts',
  'src/content/resource-detector.ts',
  'src/content/page-observer.ts',
  'src/content/cursor-overlay.ts',
  'src/content/floating-widget.ts',
  'src/content/content-script.ts',
];

let concatenated = '';

for (const relPath of files) {
  const fullPath = path.join(extensionRoot, relPath);
  let src = fs.readFileSync(fullPath, 'utf8');

  // Strip imports
  src = src.replace(/import\s+.*?from\s+['"].*?['"];?\s*/g, '');
  src = src.replace(/import\s+type\s+.*?from\s+['"].*?['"];?\s*/g, '');
  src = src.replace(/import\s+['"].*?['"];?\s*/g, '');

  // Strip export keywords from declarations
  src = src.replace(/\bexport\s+(const|let|var|function|class|interface|type|enum)\s+/g, '$1 ');
  src = src.replace(/\bexport\s+default\s+/g, '');
  src = src.replace(/\bexport\s*\{[^}]*\};?\s*/g, '');

  concatenated += `\n// --- ${relPath} ---\n` + src;
}

// Transpile with TypeScript
const transpileResult = ts.transpileModule(concatenated, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    removeComments: false,
  },
});

let outputCleaned = transpileResult.outputText;
// Remove any stray Object.defineProperty(exports, "__esModule", ...)
outputCleaned = outputCleaned.replace(/Object\.defineProperty\(exports,\s*"__esModule",\s*\{[^}]*\}\);?/g, '');
outputCleaned = outputCleaned.replace(/exports\.[a-zA-Z0-9_$]+\s*=\s*void 0;?/g, '');

const bundledCode = `(function(window, document) {
'use strict';
var exports = typeof exports !== 'undefined' ? exports : {};
var module = typeof module !== 'undefined' ? module : { exports: {} };

${outputCleaned}
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);\n`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, bundledCode, 'utf8');

console.log(`✅ Bundled content script written to: ${outputFile} (${(bundledCode.length / 1024).toFixed(2)} KB)`);

// Compile Service Worker
const swSource = fs.readFileSync(path.join(extensionRoot, 'src/background/service-worker.ts'), 'utf8');
const swTranspiled = ts.transpileModule(swSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
  },
});
const swOutputFile = path.join(extensionRoot, 'dist/background/service-worker.js');
fs.mkdirSync(path.dirname(swOutputFile), { recursive: true });
fs.writeFileSync(swOutputFile, swTranspiled.outputText, 'utf8');
console.log(`✅ Compiled service worker written to: ${swOutputFile}`);

// Copy public/manifest.json to dist/manifest.json
const publicManifest = path.join(extensionRoot, 'public/manifest.json');
const distManifest = path.join(extensionRoot, 'dist/manifest.json');
if (fs.existsSync(publicManifest)) {
  fs.copyFileSync(publicManifest, distManifest);
  console.log(`✅ Synced manifest.json to ${distManifest}`);
}

// Copy public/icons to dist/icons
const publicIcons = path.join(extensionRoot, 'public/icons');
const distIcons = path.join(extensionRoot, 'dist/icons');
if (fs.existsSync(publicIcons)) {
  fs.mkdirSync(distIcons, { recursive: true });
  const iconFiles = fs.readdirSync(publicIcons);
  for (const f of iconFiles) {
    fs.copyFileSync(path.join(publicIcons, f), path.join(distIcons, f));
  }
  console.log(`✅ Synced icons to ${distIcons}`);
}
