#!/bin/bash
# Запуск METEORA TERMINAL (движок + интерфейс) одной кнопкой.
cd "$(dirname "$0")" || exit 1

if [ ! -d node_modules ]; then
  echo "▶ Устанавливаем зависимости (первый запуск)…"
  npm install --no-audit --no-fund || exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  METEORA TERMINAL"
echo "  ────────────────────────────────────────"
echo "  Интерфейс:  http://localhost:3000"
[ -n "$IP" ] && echo "  Телефон:    http://$IP:3000   (та же сеть Wi-Fi)"
echo "  Логин:      admin@meteora.local / meteora2026"
echo "  ────────────────────────────────────────"
echo "  Стоп:       ./scripts/serve.sh stop"
echo ""

./scripts/serve.sh start
