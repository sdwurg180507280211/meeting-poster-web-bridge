#!/bin/zsh
set -e
umask 077
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 22 或更高版本。"
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "当前 Node.js 版本为 $(node -v)，本项目需要 Node.js 22 或更高版本。"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖..."
  npm ci
fi
if [ ! -f .env ]; then
  echo "缺少 .env，请先复制 .env.example 为 .env 并填写 Supabase 配置。"
  exit 1
fi
chmod 600 .env
exec node src/agent.js
