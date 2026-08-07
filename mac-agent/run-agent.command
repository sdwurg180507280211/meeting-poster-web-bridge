#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖..."
  npm install
fi
if [ ! -f .env ]; then
  echo "缺少 .env，请先复制 .env.example 为 .env 并填写 Supabase 配置。"
  exit 1
fi
npm start
