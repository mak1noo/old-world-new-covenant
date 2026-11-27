import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    proxy: { '/ws': { target: 'ws://127.0.0.1:8080', ws: true }, '/api/account': 'http://127.0.0.1:8080' },
  },
});
