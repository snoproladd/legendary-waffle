
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the project root as the folder where this file resides
  root: '.',

  // Build to your existing public/js path so you don't have to change EJS references
  build: {
    outDir: 'public/js',
    emptyOutDir: false, // do not wipe public/js if you also serve other static files there
    sourcemap: true,
    rollupOptions: {
      // Declare explicit entry points so Vite/ Rollup names the file predictably
      input: {
        phoneVer: 'src/phoneVer.js',
      },
      output: {
        // Ensure stable file name (no content hash) so CSP stays simple
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },

  // Dev server if you want to test locally (optional)
  server: {
    port: 5173,
    strictPort: false,
  },

  // Let Vite resolve ESM for imask from node_modules
  resolve: {
    dedupe: ['imask'],
  },
});
