#!/bin/zsh
set -u

LOG_FILE="$HOME/MeetingPosterAgent/.service/mac-agent.log"

clear
printf "\n========================================\n"
printf "  系列会议海报 · Mac Agent 日志\n"
printf "========================================\n\n"

if [ ! -f "$LOG_FILE" ]; then
  echo "还没有日志文件：$LOG_FILE"
  echo "请先运行『启动海报服务.command』。"
  read "?按回车退出..."
  exit 0
fi

echo "日志文件：$LOG_FILE"
echo "按 Ctrl+C 结束实时查看。"
echo ""
tail -n 80 -f "$LOG_FILE"
