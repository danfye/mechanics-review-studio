#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/"
  read "unused?按回车退出..."
  exit 1
fi
node scripts/launch-local.cjs
