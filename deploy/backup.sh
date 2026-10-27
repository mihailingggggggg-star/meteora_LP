#!/usr/bin/env bash
# Бэкап базы движка: консистентная копия через `sqlite3 .backup` + gzip, ротация KEEP дней.
#
# Использование:
#   sudo bash deploy/backup.sh              # один прогон
#   (cron) 0 3 * * * /usr/bin/bash /opt/meteora-terminal/deploy/backup.sh >/dev/null 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DB="${DB:-$APP_DIR/data/engine.db}"
DEST="${DEST:-$APP_DIR/data/backups}"
KEEP="${KEEP:-14}"

[[ -f "$DB" ]] || { echo "нет базы $DB — бэкапить нечего"; exit 0; }
mkdir -p "$DEST"

STAMP="$(date +%F_%H%M%S)"
OUT="$DEST/engine-$STAMP.db.gz"

if command -v sqlite3 >/dev/null 2>&1; then
  TMP="$(mktemp "$DEST/.engine-$STAMP.XXXXXX.db")"
  sqlite3 "$DB" ".backup '$TMP'"   # атомарный бэкап даже при работающем движке (WAL)
  gzip -9 -c "$TMP" > "$OUT"
  rm -f "$TMP"
else
  # без sqlite3 — просто копия вместе с WAL/SHM
  TMP="$(mktemp -d)"
  cp "$DB" "$TMP/engine.db"
  [[ -f "$DB-wal" ]] && cp "$DB-wal" "$TMP/engine.db-wal" || true
  [[ -f "$DB-shm" ]] && cp "$DB-shm" "$TMP/engine.db-shm" || true
  tar -czf "$OUT" -C "$TMP" . && rm -rf "$TMP"
fi

# ротация
find "$DEST" -name 'engine-*.db.gz' -type f -mtime "+$KEEP" -delete 2>/dev/null || true

SIZE="$(du -h "$OUT" | cut -f1)"
COUNT="$(find "$DEST" -name 'engine-*.db.gz' -type f | wc -l | tr -d ' ')"
echo "бэкап готов: $OUT ($SIZE), хранится копий: $COUNT (ротация $KEEP дней)"
