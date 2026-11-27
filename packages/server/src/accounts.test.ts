import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '../../shared/src/protocol';
import { accountRoutes } from './accounts';
import { attachRooms } from './room';

test('账号支持中文及特殊字符，注册并发安全，服务重启后仍能登录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'covenant-accounts-'));
  const filename = join(directory, 'accounts.json');
  let routes = accountRoutes(filename);
  const server = createServer((request, response) => void routes.handleAccount(request, response, request.url!));
  const rooms = attachRooms(server, { accountName: request => routes.nameForRequest(request) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const address = `http://127.0.0.1:${port}/api/account`;
  const name = ' 中文 🙂 !@# ';
  const password = '密 码 @!?';
  const post = (action: string, body = { name, password }, cookie?: string) =>
    fetch(`${address}/${action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const check = (cookie: string) => fetch(address, { headers: { cookie } }).then(response => response.json());

  try {
    const registrations = await Promise.all([post('register'), post('register'), post('register', { name: '另一个', password })]);
    expect(registrations.map(response => response.status).sort()).toEqual([200, 200, 409]);
    const storage = await readFile(filename, 'utf8');
    expect(storage).not.toContain(password);
    expect(JSON.parse(storage)).toEqual(expect.arrayContaining([
      { name, salt: expect.stringMatching(/^[0-9a-f]{32}$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { name: '另一个', salt: expect.any(String), hash: expect.any(String) },
    ]));

    routes = accountRoutes(filename);
    expect((await post('login', { name, password: '错误密码' })).status).toBe(401);
    const login = await post('login');
    expect(await login.json()).toEqual({ name });
    const cookies = login.headers.getSetCookie();
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringContaining('Path=/api/account; HttpOnly'),
      expect.stringContaining('Path=/ws; HttpOnly'),
    ]));
    const cookie = cookies[0].split(';')[0];
    expect(await check(cookie)).toEqual({ name });
    async function socket(session?: string) {
      const connection = new WebSocket(`ws://127.0.0.1:${port}/ws`, session ? { headers: { cookie: session } } : {});
      await once(connection, 'open');
      return connection;
    }
    function receive<T extends ServerMessage['type']>(connection: WebSocket, type: T) {
      return new Promise<Extract<ServerMessage, {type: T}>>(resolve => {
        const read = (raw: WebSocket.RawData) => {
          const message = JSON.parse(raw.toString()) as ServerMessage;
          if (message.type !== type) return;
          connection.off('message', read);
          resolve(message as Extract<ServerMessage, {type: T}>);
        };
        connection.on('message', read);
      });
    }
    const host = await socket(cookie);
    const lobby = receive(host, 'lobby');
    host.send(JSON.stringify({ type: 'create', name: '冒充的名称' }));
    const { code } = await lobby;
    const guest = await socket();
    const matches = [receive(host, 'state'), receive(guest, 'state')];
    guest.send(JSON.stringify({ type: 'join', code, name }));
    for (const match of await Promise.all(matches)) expect(match.view.playerNames).toEqual([name, null]);

    expect((await post('logout', undefined, cookie)).status).toBe(200);
    expect(await check(cookie)).toEqual({ name: null });
  } finally {
    for (const connection of rooms.clients) connection.terminate();
    await new Promise<void>(resolve => rooms.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
