/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Static site: works from any sub-path (GitHub Pages included) because every
// asset is referenced relatively and data files go through import.meta.env.BASE_URL.
//
// Service worker (Workbox, generateSW): precaches the build, the self-hosted fonts, the question
// bank and DuckDB's `eh` wasm, so the app opens and the library works offline. New builds wait
// for "Update available · Reload" (registerType 'prompt'), never a silent swap mid-session.
// The `mvp` wasm (old browsers only) is cached the first time it is fetched.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['exponent-bank.json'],
      // The manifest is the static public/manifest.webmanifest (icons, shortcuts), linked from index.html.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,json,svg,png,webmanifest}', '**/duckdb-eh-*.wasm', '**/duckdb-browser-eh.worker-*.js'],
        globIgnores: ['**/duckdb-mvp-*.wasm', '**/duckdb-browser-mvp.worker-*.js', '**/duckdb-coi*'],
        maximumFileSizeToCacheInBytes: 48 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Sign-in redirects and the API belong to the Mock server, never to the cached shell.
        navigateFallbackDenylist: [/\/auth\//, /\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [{ urlPattern: /duckdb-.*mvp.*\.(wasm|js)$/, handler: 'CacheFirst', options: { cacheName: 'duckdb-mvp', expiration: { maxEntries: 4 } } }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // `npm run dev` with `make server` (the Go server) alongside: the API and sign-in go to the Mock server.
  server: { proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
