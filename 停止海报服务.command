#!/bin/zsh
set -u
umask 077

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$ROOT_DIR/mac-agent"
RUNTIME_DIR="$HOME/MeetingPosterAgent/.service"
PID_FILE="$RUNTIME_DIR/mac-agent.pid"

clear
printf "\n========================================\n"
printf "  系列会议海报 · 停止本地服务\n"
printf "========================================\n\n"

find_agent_pids() {
  local candidate process_cwd
  ps -axo pid=,comm=,command= | awk '$2 == "node" && $0 ~ /node[[:space:]]+src\/agent\.js([[:space:]]|$)/ {print $1}' | while IFS= read -r candidate; do
    process_cwd="$(/usr/sbin/lsof -a -p "$candidate" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [ "$process_cwd" = "$AGENT_DIR" ]; then
      echo "$candidate"
    fi
  done
}

TARGET_PIDS=()
add_target_pid() {
  local candidate="$1" existing
  if [ -z "$candidate" ] || ! kill -0 "$candidate" 2>/dev/null; then return; fi
  for existing in "${TARGET_PIDS[@]}"; do
    if [ "$existing" = "$candidate" ]; then return; fi
  done
  TARGET_PIDS+=("$candidate")
}

if [ -f "$PID_FILE" ]; then
  add_target_pid "$(cat "$PID_FILE" 2>/dev/null || true)"
fi
while IFS= read -r FOUND_PID; do
  add_target_pid "$FOUND_PID"
done < <(find_agent_pids)

if [ "${#TARGET_PIDS[@]}" -eq 0 ]; then
  rm -f "$PID_FILE"
  echo "ℹ️ 没有发现正在运行的 Mac Agent，已清理旧状态。"
else
  echo "▶ 正在停止 Mac Agent（PID ${TARGET_PIDS[*]}）..."
  for PID in "${TARGET_PIDS[@]}"; do kill "$PID" 2>/dev/null || true; done
  for i in {1..20}; do
    STILL_RUNNING=0
    for PID in "${TARGET_PIDS[@]}"; do
      if kill -0 "$PID" 2>/dev/null; then STILL_RUNNING=1; fi
    done
    if [ "$STILL_RUNNING" -eq 0 ]; then break; fi
    sleep 0.25
  done
  for PID in "${TARGET_PIDS[@]}"; do
    if kill -0 "$PID" 2>/dev/null; then
      echo "⚠️ PID $PID 未正常退出，正在强制停止..."
      kill -9 "$PID" 2>/dev/null || true
    fi
  done
  echo "✅ Mac Agent 已停止。"
fi

rm -f "$PID_FILE"
echo ""
echo "Photoshop 不会被自动关闭，避免影响你正在编辑的文件。"
echo "网页在线状态会在几十秒内自动变为离线。"

osascript -e 'display notification "Mac Agent 已停止。" with title "系列会议海报服务"' >/dev/null 2>&1 || true
read "?按回车关闭此窗口..."
