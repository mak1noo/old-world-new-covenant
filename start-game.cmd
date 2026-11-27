@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 20 or newer from https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0start-game.mjs" %*
if errorlevel 1 pause
