/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Static site: works from any sub-path (GitHub Pages included) because every
// asset is referenced relatively and data files go through import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
