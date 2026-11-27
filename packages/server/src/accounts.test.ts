import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { accountRoutes } from './accounts';

test('账号支持中文及特殊字符，注册并发安全，服务重启后仍能登录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'covenant-accounts-'));
  const filename = join(directory, 'accounts.json');
  let routes = accountRoutes(filename);
  const server = createServer((request, response) => void routes(request, response, request.url!));
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
    const session = login.headers.get('set-cookie')!;
    expect(session).toContain('HttpOnly');
    const cookie = session.split(';')[0];
    expect(await check(cookie)).toEqual({ name });
    expect((await post('logout', undefined, cookie)).status).toBe(200);
    expect(await check(cookie)).toEqual({ name: null });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
