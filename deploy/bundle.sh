#!/usr/bin/env bash
# Собирает архив проекта для переноса на VPS (без node_modules/.next/.git).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-/tmp/meteora-terminal-$(date +%F).tar.gz}"

# останавливаем движок, чтобы БД была консистентной, и запускаем обратно
WAS_RUNNING=0
if curl -fsS -m 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then WAS_RUNNING=1; ./scripts/serve.sh stop >/dev/null 2>&1 || true; fi

tar -czf "$OUT" \
  --exclude node_modules --exclude .git --exclude .run \
  --exclude ".next/cache" --exclude ".next/trace" --exclude "apps/web/.next/cache" \
  --exclude "journal/*.gz" --exclude ".DS_Store" \
  .

[[ $WAS_RUNNING -eq 1 ]] && ./scripts/serve.sh start >/dev/null 2>&1 || true

echo "готово: $OUT ($(du -h "$OUT" | cut -f1))"
echo "содержимое: код, .env, data/engine.db, journal/, готовая сборка .next (на VPS не нужно собирать)"
