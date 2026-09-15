import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
let mediabunnyVersion = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(resolve(root, 'node_modules/mediabunny/package.json'), 'utf8')) as { version?: string };
  if (pkg.version) mediabunnyVersion = pkg.version;
} catch { /* version display degrades gracefully */ }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __MEDIABUNNY_VERSION__: JSON.stringify(mediabunnyVersion),
  },
  server: {
    port: 5173,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mediabunny'],
  },
});
