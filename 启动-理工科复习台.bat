@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node scripts\launch-local.cjs
pause
