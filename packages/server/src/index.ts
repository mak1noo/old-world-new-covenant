import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRooms } from './room';
import { accountRoutes } from './accounts';
import { validateCards } from '../../shared/src/cards';

validateCards();
const { handleAccount, nameForRequest } = accountRoutes(process.env.COVENANT_ACCOUNTS_FILE ??
  fileURLToPath(new URL('../../../accounts.json', import.meta.url)));
const distribution = fileURLToPath(new URL('../../client/dist', import.meta.url));
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png',
};

export const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/api/account' || path.startsWith('/api/account/')) {
    await handleAccount(request, response, path);
    return;
  }
  if (path === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  const file = resolve(distribution, '.' + (path === '/' ? '/index.html' : path));
  const details = file.startsWith(distribution + sep) ? await stat(file).catch(() => null) : null;
  if (!details?.isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('页面不存在');
    return;
  }
  response.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).on('error', () => response.destroy()).pipe(response);
});
attachRooms(server, { accountName: nameForRequest });
server.listen({ port: Number(process.env.PORT ?? 8080), host: process.env.COVENANT_HOST }, () => {
  console.log(`旧界新约 http://localhost:${(server.address() as { port: number }).port}`);
});
