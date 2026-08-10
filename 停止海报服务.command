#!/bin/zsh
set -u

RUNTIME_DIR="$HOME/MeetingPosterAgent/.service"
PID_FILE="$RUNTIME_DIR/mac-agent.pid"

clear
printf "\n========================================\n"
printf "  系列会议海报 · 停止本地服务\n"
printf "========================================\n\n"

if [ ! -f "$PID_FILE" ]; then
  echo "ℹ️ 没有找到 Mac Agent PID 文件，可能已经停止。"
  read "?按回车退出..."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -z "${PID:-}" ]; then
  rm -f "$PID_FILE"
  echo "ℹ️ PID 文件为空，已清理。"
  read "?按回车退出..."
  exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
  echo "▶ 正在停止 Mac Agent（PID $PID）..."
  kill "$PID" 2>/dev/null || true
  for i in {1..20}; do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "⚠️ Agent 未正常退出，正在强制停止..."
    kill -9 "$PID" 2>/dev/null || true
  fi
  echo "✅ Mac Agent 已停止。"
else
  echo "ℹ️ PID $PID 已不存在，清理旧状态。"
fi

rm -f "$PID_FILE"
echo ""
echo "Photoshop 不会被自动关闭，避免影响你正在编辑的文件。"
echo "网页在线状态会在几十秒内自动变为离线。"

osascript -e 'display notification "Mac Agent 已停止。" with title "系列会议海报服务"' >/dev/null 2>&1 || true
read "?按回车关闭此窗口..."
