#!/usr/bin/env bash
# Tarik perubahan terbaru dari GitHub lalu restart service DompetKu.
# Dijalankan di server (lenovo): ~/dompetku/deploy/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/dompetku}"
cd "$APP_DIR"

echo "==> git pull ($(git remote get-url origin))"
git pull --ff-only

if [ -f deploy/dompetku.service ]; then
  mkdir -p "$HOME/.config/systemd/user"
  cp deploy/dompetku.service "$HOME/.config/systemd/user/dompetku.service"
fi

echo "==> restart service"
systemctl --user daemon-reload
systemctl --user restart dompetku

sleep 1
systemctl --user --no-pager --lines=3 status dompetku || true
curl -fsS "http://127.0.0.1:${DOMPETKU_PORT:-8090}/api/health" && echo
echo "==> selesai"