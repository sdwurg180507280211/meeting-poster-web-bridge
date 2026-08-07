#!/bin/zsh
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/UXP/Plugins/External/meeting-poster-web-worker"
echo "安装到：$DEST"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
echo "安装完成。请完全退出并重新启动 Photoshop。"
