@echo off
cd /d "%~dp0"
set "PORT=25565"
set "COVENANT_HOST=127.0.0.1"
echo 旧界新约 v0.0.2 联机开服
echo 本机地址 http://127.0.0.1:25565/
echo 请使用 SakuraFrp 将公网连接转发到 127.0.0.1:25565
echo 保持此窗口打开以继续开服
node start-game.mjs
pause
