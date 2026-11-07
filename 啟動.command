#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '請先安裝 Node.js 18 或以上版本：https://nodejs.org/'
  read -r -p '按 Enter 關閉…' _
  exit 1
fi
printf '\n正體字帖工坊將啟動於 http://localhost:4173\n按 Control+C 停止。\n\n'
node scripts/serve.mjs
