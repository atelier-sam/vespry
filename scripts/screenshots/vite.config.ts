import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Build du harnais de captures — page web ordinaire (PAS l'extension), donc
// pas de plugin @crxjs. Juste Preact pour rendre le vrai overlay avec un
// contrôleur factice. Sortie : scripts/screenshots/dist/ (gitignorée).
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [preact()],
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        harness: resolve(here, 'harness.html'),
        export: resolve(here, 'export-harness.html'),
      },
    },
  },
});
