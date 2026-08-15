import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';

// Custom plugin to build service worker and content script as separate bundles.
function buildExtensionScripts() {
  let isBuilding = false;
  return {
    name: 'build-extension-scripts',
    async closeBundle() {
      if (isBuilding) return;
      isBuilding = true;
      try {
        // Build service worker as ES module
        await viteBuild({
          configFile: false,
          build: {
            emptyOutDir: false,
            outDir: resolve(__dirname, 'dist'),
            lib: {
              entry: resolve(__dirname, 'src/background/service-worker.ts'),
              formats: ['es'],
              fileName: () => 'background/service-worker.js',
            },
            rollupOptions: {
              output: { inlineDynamicImports: true },
            },
          },
          resolve: {
            alias: { '@': resolve(__dirname, 'src') },
          },
        });

        // Build content script as IIFE (no imports)
        await viteBuild({
          configFile: false,
          build: {
            emptyOutDir: false,
            outDir: resolve(__dirname, 'dist'),
            lib: {
              entry: resolve(__dirname, 'src/content/content-script.ts'),
              formats: ['iife'],
              name: 'NerdBuddyContent',
              fileName: () => 'content/content-script.js',
            },
            rollupOptions: {
              output: { inlineDynamicImports: true },
            },
          },
          resolve: {
            alias: { '@': resolve(__dirname, 'src') },
          },
        });
      } finally {
        isBuilding = false;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), buildExtensionScripts()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
      },
      output: {
        entryFileNames: '[name]/[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
