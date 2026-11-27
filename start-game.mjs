import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';

const bundle = new URL('./packages/server/dist/index.mjs', import.meta.url);
const client = new URL('./packages/client/dist/index.html', import.meta.url);

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error('启动游戏需要 Node.js 20 或更高版本。');
  process.exit(1);
}
if (!existsSync(bundle) || !existsSync(client)) {
  console.error('找不到游戏构建文件。请完整解压游戏包，或在源码目录运行 pnpm build。');
  process.exit(1);
}

process.env.PORT ??= '0';
process.env.COVENANT_HOST ??= '127.0.0.1';

try {
  const { server } = await import(bundle.href);
  if (!server.listening) await once(server, 'listening');
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`在浏览器打开 ${url}`);
  console.log('关闭这个窗口或按 Ctrl+C 退出游戏。');
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
    browser.on('error', () => console.log('可把上方地址复制到浏览器。'));
    browser.unref();
  }
} catch (error) {
  console.error('游戏启动失败。', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
