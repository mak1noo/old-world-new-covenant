import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const bodyLimit = 16 * 1024;
const expiresAfter = 24 * 60 * 60;
const cookieName = 'covenant_session';
type Account = { name: string; salt: string; hash: string };
type Session = { name: string; expires: number };

class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function credentials(request: IncomingMessage): Promise<{ name: string; password: string }> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AccountError(415, '账号请求格式无效');
  }
  if (Number(request.headers['content-length']) > bodyLimit) {
    request.resume();
    throw new AccountError(413, '账号请求过大');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > bodyLimit) {
      request.resume();
      throw new AccountError(413, '账号请求过大');
    }
    chunks.push(chunk);
  }
  let data: { name?: unknown; password?: unknown } | null;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AccountError(400, '账号请求格式无效');
  }
  if (typeof data?.name !== 'string' || !data.name || typeof data.password !== 'string' || !data.password) {
    throw new AccountError(400, '请输入账号名称和密码');
  }
  return { name: data.name, password: data.password };
}

function respond(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

export function accountRoutes(filename: string) {
  const sessions = new Map<string, Session>();
  const lockFile = `${filename}.lock`;

  async function readAccounts(): Promise<Account[]> {
    const file = await readFile(filename, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    const accounts = JSON.parse(file);
    if (!Array.isArray(accounts) || accounts.some(account =>
      typeof account?.name !== 'string' || typeof account.salt !== 'string' || !/^[0-9a-f]{64}$/.test(account.hash))) {
      throw new Error('账号文件格式无效');
    }
    return accounts;
  }

  async function register(name: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password, salt, 32) as Buffer).toString('hex');
    const deadline = Date.now() + 2000;
    const lock = await acquireLock();
    const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const accounts = await readAccounts();
      if (accounts.some(account => account.name === name)) throw new AccountError(409, '这个账号名称已注册');
      accounts.push({ name, salt, hash });
      await writeFile(temporary, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch(() => {});
      try { await lock.close(); } finally { await unlink(lockFile); }
    }

    async function acquireLock() {
      while (true) {
        try {
          return await open(lockFile, 'wx', 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (Date.now() >= deadline) throw new AccountError(503, '账号文件正在写入，请稍后重试');
          await delay(30);
        }
      }
    }
  }

  function sessionToken(request: IncomingMessage): string {
    return request.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
  }

  function nameForRequest(request: IncomingMessage): string | null {
    const token = sessionToken(request);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires > Date.now()) return session.name;
    sessions.delete(token);
    return null;
  }

  function cookie(request: IncomingMessage, response: ServerResponse, value: string, age: number): void {
    const secure = request.headers.origin?.startsWith('https://') ||
      request.headers['x-forwarded-proto']?.toString().split(',')[0].trim() === 'https';
    response.setHeader('Set-Cookie', ['/api/account', '/ws'].map(path =>
      `${cookieName}=${value}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`));
  }

  async function handleAccount(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    try {
      const token = sessionToken(request);
      const now = Date.now();
      if (path === '/api/account' && request.method === 'GET') {
        respond(response, 200, { name: nameForRequest(request) });
        return;
      }
      if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
        throw new AccountError(403, '请从游戏页面操作账号');
      }
      if (request.method !== 'POST') throw new AccountError(405, '账号请求方法无效');
      if (path === '/api/account/logout') {
        sessions.delete(token);
        cookie(request, response, '', 0);
        respond(response, 200, { name: null });
        return;
      }
      if (path !== '/api/account/register' && path !== '/api/account/login') throw new AccountError(404, '账号接口不存在');
      const { name, password } = await credentials(request);
      if (path.endsWith('/register')) await register(name, password);
      else {
        const account = (await readAccounts()).find(entry => entry.name === name);
        const hash = await derive(password, account?.salt ?? 'missing-account', 32) as Buffer;
        if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) {
          throw new AccountError(401, '账号名称或密码不正确');
        }
      }

      for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
      sessions.delete(token);
      const next = randomBytes(32).toString('hex');
      sessions.set(next, { name, expires: now + expiresAfter * 1000 });
      cookie(request, response, next, expiresAfter);
      respond(response, 200, { name });
    } catch (error) {
      if (error instanceof AccountError) respond(response, error.status, { error: error.message });
      else {
        console.error('账号服务发生错误', error instanceof Error ? error.message : error);
        respond(response, 500, { error: '无法访问账号文件' });
      }
    }
  }

  return { handleAccount, nameForRequest };
}
