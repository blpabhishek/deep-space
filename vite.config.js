import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the site works under https://<user>.github.io/deep-space/
  base: './',
  build: {
    // GitHub Pages can serve main:/docs directly — no deploy branch needed
    outDir: 'docs',
  },
});
