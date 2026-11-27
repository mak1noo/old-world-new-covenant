# 旧界新约

原创双人卡牌对战游戏的桌面网页版。支持两档 AI 和房间码联机。建议使用桌面 Chrome 或 Edge，视口至少 1280 × 800。

## 启动

从 [GitHub Releases](https://github.com/mak1noo/old-world-new-covenant/releases/tag/v0.0.1) 下载 `旧界新约v0.0.1.zip`。需要 Node.js 20 或更新版本。

完整解压游戏包后，Windows 双击 `点击启动游戏.cmd`，macOS 或 Linux 在解压目录运行 `./start-game.sh`。脚本自动打开浏览器。关闭启动窗口或按 Ctrl+C 退出。

下载包已包含客户端和服务端构建文件，启动只需 Node.js。

### 开发启动

源码开发需要与 Node.js 版本兼容的 pnpm。开发验证使用 Node.js 24、pnpm 11。

```sh
pnpm install
pnpm build
pnpm start
```

打开 http://localhost:8080。开发时也可运行 `pnpm dev`，客户端由 Vite 提供，WebSocket 转发到本地 8080。

联机玩家需访问同一个正在运行的服务端。由一方创建房间，另一方输入六位房间码。服务端状态存在内存中。

## 测试

```sh
pnpm test
```

测试包括 500 局随机对战，运行约 1–2 分钟。结果摘要见 `TEST-REPORT.md`。

## 目录

- `data/cards.json` 存放运行时卡牌数值、配方、技能和常量。
- `packages/shared` 实现共享规则、合法操作、视角投影和测试。
- `packages/server` 实现 HTTP、WebSocket 房间与两档 AI。
- `packages/client` 实现 React 页面和操作界面。
- `DECISIONS.md` 记录作者最终确认的裁定。
- `HANDOFF.md` 记录里程碑与继续开发所需信息。

## 版本范围

战场使用原创修道院背景与 CSS 卡面。当前卡牌数据包含种族，缺少阵营归属的卡统一显示为「未指定阵营」。断线会结束房间。锁定 a 位和翻面状态按规格预留，特殊融合、断线续局、移动端以及面向玩家的回放不在本版本范围内。
