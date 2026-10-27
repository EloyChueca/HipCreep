import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/HipCreep/) and Cloudflare Pages (/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5174,
    open: true,
  },
});
