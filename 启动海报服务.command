#!/bin/zsh
set -u
umask 077

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$ROOT_DIR/mac-agent"
RUNTIME_DIR="$HOME/MeetingPosterAgent/.service"
PID_FILE="$RUNTIME_DIR/mac-agent.pid"
LOG_FILE="$RUNTIME_DIR/mac-agent.log"
PUBLIC_URL="https://meeting-poster-web-bridge.vercel.app/"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

clear
printf "\n========================================\n"
printf "  系列会议海报 · 本地服务启动\n"
printf "========================================\n\n"
printf "工程目录：%s\n" "$ROOT_DIR"

if [ ! -d "$AGENT_DIR" ]; then
  echo "❌ 找不到 mac-agent 目录：$AGENT_DIR"
  read "?按回车退出..."
  exit 1
fi

if [ ! -f "$AGENT_DIR/.env" ]; then
  echo "❌ 缺少 mac-agent/.env"
  echo "请先完成 Supabase Secret Key 配置。"
  open "$AGENT_DIR" >/dev/null 2>&1 || true
  read "?按回车退出..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 Node.js。请先安装 Node.js 22 或更高版本。"
  read "?按回车退出..."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ 当前 Node.js 版本为 $(node -v)，本项目需要 Node.js 22 或更高版本。"
  read "?按回车退出..."
  exit 1
fi

chmod 600 "$AGENT_DIR/.env"

if [ ! -d "$AGENT_DIR/node_modules" ]; then
  echo "首次运行：正在安装 Mac Agent 依赖..."
  (cd "$AGENT_DIR" && npm ci)
  if [ $? -ne 0 ]; then
    echo "❌ npm install 失败。"
    read "?按回车退出..."
    exit 1
  fi
fi

find_agent_pids() {
  local candidate process_cwd
  ps -axo pid=,comm=,command= | awk '$2 == "node" && $0 ~ /node[[:space:]]+src\/agent\.js([[:space:]]|$)/ {print $1}' | while IFS= read -r candidate; do
    process_cwd="$(/usr/sbin/lsof -a -p "$candidate" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [ "$process_cwd" = "$AGENT_DIR" ]; then
      echo "$candidate"
    fi
  done
}

RUNNING_PIDS=()
while IFS= read -r RUNNING_PID; do
  if [ -n "$RUNNING_PID" ]; then RUNNING_PIDS+=("$RUNNING_PID"); fi
done < <(find_agent_pids)

AGENT_RUNNING=0
if [ "${#RUNNING_PIDS[@]}" -gt 1 ]; then
  echo "❌ 检测到多个旧版 Mac Agent 正在运行（PID ${RUNNING_PIDS[*]}）。"
  echo "请先运行『停止海报服务.command』，再重新启动；新版本会强制保持单实例。"
  read "?按回车退出..."
  exit 1
elif [ "${#RUNNING_PIDS[@]}" -eq 1 ]; then
  AGENT_RUNNING=1
  echo "${RUNNING_PIDS[1]}" > "$PID_FILE"
  chmod 600 "$PID_FILE"
  echo "✅ Mac Agent 已经在运行（PID ${RUNNING_PIDS[1]}），不会重复启动。"
elif [ -f "$PID_FILE" ]; then
  rm -f "$PID_FILE"
fi

if [ "$AGENT_RUNNING" -eq 0 ]; then
  echo "▶ 正在启动 Mac Agent..."
  (
    cd "$AGENT_DIR" || exit 1
    nohup node src/agent.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  chmod 600 "$PID_FILE"
  sleep 1
  NEW_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${NEW_PID:-}" ] && kill -0 "$NEW_PID" 2>/dev/null; then
    echo "✅ Mac Agent 已启动（PID $NEW_PID）"
  else
    echo "❌ Mac Agent 启动失败。最近日志："
    tail -n 30 "$LOG_FILE" 2>/dev/null || true
    read "?按回车退出..."
    exit 1
  fi
fi

echo "▶ 正在打开 Photoshop..."
PS_OPENED=0
for APP_NAME in "Adobe Photoshop 2026" "Adobe Photoshop 2025" "Adobe Photoshop"; do
  if open -Ra "$APP_NAME" >/dev/null 2>&1; then
    open -a "$APP_NAME"
    echo "✅ 已打开：$APP_NAME"
    PS_OPENED=1
    break
  fi
done

if [ "$PS_OPENED" -eq 0 ]; then
  echo "⚠️ 没有自动找到 Photoshop，请手动打开 Photoshop。"
fi

sleep 2
open "$PUBLIC_URL" >/dev/null 2>&1 || true

echo "✅ 已打开公网海报页面：$PUBLIC_URL"
echo ""
echo "日志：$LOG_FILE"
echo ""
echo "如果 Photoshop 没有自动显示『海报 Web Worker』面板："
echo "请在 Photoshop → 插件 / Plugins → 海报 Web Worker 打开一次。"
echo ""
echo "启动完成。这个终端窗口现在可以关闭，Mac Agent 会继续后台运行。"

osascript -e 'display notification "Mac Agent 已启动，Photoshop 已打开。" with title "系列会议海报服务"' >/dev/null 2>&1 || true

read "?按回车关闭此窗口..."
