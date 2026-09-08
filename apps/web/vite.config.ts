import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Read the API port from the same .env the server reads, so the proxy and the
// server can never disagree about where the API is.
function apiPort(): number {
  for (const file of [
    path.resolve(HERE, '..', '..', '.env'),
    path.resolve(HERE, '..', 'api', '.env'),
  ]) {
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^\s*API_PORT\s*=\s*"?(\d+)"?/m);
    if (m) return Number(m[1]);
  }
  return 4100;
}

const API = `http://127.0.0.1:${apiPort()}`;

export default defineConfig({
  plugins: [react()],
  server: {
    // A port of its own, away from the 5173 range other local Vite projects
    // grab first. strictPort makes a clash fail loudly at startup instead of
    // silently moving the store to a neighbouring port, which leaves every
    // hard-coded link on the marketing site pointing at somebody else's app.
    port: 5273,
    strictPort: true,
    proxy: {
      // Same-origin API in development, so the refresh cookie behaves exactly
      // as it does in production (spec §4.2.1).
      '/api': { target: API, changeOrigin: true },
      '/media': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
