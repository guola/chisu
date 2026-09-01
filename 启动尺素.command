#!/bin/zsh

set -e

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "无法启动尺素" message "这台电脑尚未安装 Node.js。" as critical'
  exit 1
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "首次启动，正在准备本地运行环境…"
  npm install
fi

DEFAULT_INTERFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
LAN_ADDRESS="$(ipconfig getifaddr "$DEFAULT_INTERFACE" 2>/dev/null || true)"

if [ -z "$LAN_ADDRESS" ]; then
  LAN_ADDRESS="127.0.0.1"
fi

CHISU_URL="http://${LAN_ADDRESS}:3000/"

if curl -fsS --connect-timeout 1 "$CHISU_URL" >/dev/null 2>&1; then
  open "$CHISU_URL"
  exit 0
fi

echo ""
echo "尺素正在启动…"
echo "电脑访问：${CHISU_URL}"
echo "手机与电脑需连接同一局域网。"
echo "关闭此窗口即可停止尺素。"
echo ""

(
  for attempt in {1..60}; do
    if curl -fsS --connect-timeout 1 "$CHISU_URL" >/dev/null 2>&1; then
      open "$CHISU_URL"
      exit 0
    fi
    sleep 0.25
  done
) &

exec npm run dev
