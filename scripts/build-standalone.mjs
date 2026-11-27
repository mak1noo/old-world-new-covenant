import { createRequire } from 'node:module';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const projectRequire = createRequire(import.meta.url);
const viteRequire = createRequire(projectRequire.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');

await build({
  entryPoints: ['packages/server/src/index.ts'],
  outfile: 'packages/server/dist/index.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  legalComments: 'inline',
  logLevel: 'info',
});

const wsDirectory = dirname(projectRequire.resolve('ws/package.json'));
await copyFile(join(wsDirectory, 'LICENSE'), 'packages/server/dist/ws-LICENSE');
