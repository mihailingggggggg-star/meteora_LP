#!/usr/bin/env bash
# Собирает архив проекта для переноса на VPS.
#
# ВАЖНО: секреты (.env, .env.local) и боевая база в архив НЕ попадают.
# Раньше архив содержал .env с HELIUS_API_KEY / AUTH_SECRET / ADMIN_PASSWORD —
# то есть любой, кто получил tar.gz, получал полный доступ. Секреты доставляются
# отдельно (scp .env или ввод на сервере), база — только по флагу --with-data.
#
# Использование:
#   ./deploy/bundle.sh                 # код + готовая сборка .next
#   ./deploy/bundle.sh --with-data     # + data/engine.db (перенос истории)
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_DATA=0
OUT=""
for arg in "$@"; do
  case "$arg" in
    --with-data) WITH_DATA=1 ;;
    *) OUT="$arg" ;;
  esac
done
OUT="${OUT:-/tmp/meteora-terminal-$(date +%F).tar.gz}"

# останавливаем движок, чтобы БД была консистентной, и запускаем обратно
WAS_RUNNING=0
if curl -fsS -m 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  WAS_RUNNING=1
  ./scripts/serve.sh stop >/dev/null 2>&1 || true
fi

EXCLUDES=(
  --exclude node_modules --exclude .git --exclude .run
  --exclude ".next/cache" --exclude ".next/trace" --exclude "apps/web/.next/cache"
  --exclude "journal/*.gz" --exclude ".DS_Store"
  # секреты — никогда (.env.example остаётся: это шаблон без значений)
  --exclude "./.env" --exclude ".env.local" --exclude ".env.bak*" --exclude "apps/web/.env*"
  --exclude "apps/engine/.env" --exclude "deploy/prod.env"
  --exclude "/*.tar.gz"
)
if [[ $WITH_DATA -eq 0 ]]; then
  EXCLUDES+=(--exclude "data/*.db" --exclude "data/*.db-shm" --exclude "data/*.db-wal")
fi

tar -czf "$OUT" "${EXCLUDES[@]}" .

[[ $WAS_RUNNING -eq 1 ]] && ./scripts/serve.sh start >/dev/null 2>&1 || true

echo "готово: $OUT ($(du -h "$OUT" | cut -f1))"
echo "содержимое: код + готовая сборка .next; секреты и база НЕ включены"
if [[ $WITH_DATA -eq 1 ]]; then
  echo "  · база data/engine.db включена по флагу --with-data"
fi
echo "на сервере: распаковать и выполнить sudo bash deploy/install.sh (секреты — отдельно, в .env)"
