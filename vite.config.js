import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static site: works from any sub-path (GitHub Pages included) because every
// asset is referenced relatively and data files go through import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
