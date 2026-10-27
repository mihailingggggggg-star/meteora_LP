#!/bin/bash
# Управление локальным контуром METEORA TERMINAL
#   ./scripts/serve.sh start     — собрать (если нужно) и поднять движок + веб
#   ./scripts/serve.sh dev       — режим разработки (hot reload, порт 3000)
#   ./scripts/serve.sh stop      — остановить оба процесса
#   ./scripts/serve.sh status    — что запущено
#   ./scripts/serve.sh restart   — перезапуск
#   ./scripts/serve.sh watch     — сторож: поднимает упавший процесс (в фоне)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"

WEB_PORT="${WEB_PORT:-3000}"
ENGINE_PORT="${ENGINE_PORT:-8787}"

# на macOS держим систему бодрой, на Linux — просто запускаем
NO_SLEEP=""
if command -v caffeinate >/dev/null 2>&1; then NO_SLEEP="caffeinate -dimsu"; fi

is_up() { curl -s -o /dev/null -m 2 "http://127.0.0.1:$1$2"; }

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

start_engine() {
  if is_up "$ENGINE_PORT" /api/health; then
    echo "движок уже работает (: $ENGINE_PORT)"
    return
  fi
  echo "▶ движок :$ENGINE_PORT"
  cd "$ROOT/apps/engine"
  nohup $NO_SLEEP npx tsx src/index.ts >>"$RUN/engine.log" 2>&1 &
  echo $! >"$RUN/engine.pid"
  disown
  cd "$ROOT"
}

build_if_needed() {
  if [ -f "$ROOT/apps/web/.next/BUILD_ID" ]; then return; fi
  echo "▶ сборка интерфейса (нужна один раз или после правок)…"
  (cd "$ROOT" && npm run build) || exit 1
}

start_web() {
  if is_up "$WEB_PORT" /login; then
    echo "веб уже работает (: $WEB_PORT)"
    return
  fi
  build_if_needed
  echo "▶ веб :$WEB_PORT"
  cd "$ROOT/apps/web"
  nohup $NO_SLEEP npx next start -p "$WEB_PORT" >>"$RUN/web.log" 2>&1 &
  echo $! >"$RUN/web.pid"
  disown
  cd "$ROOT"
}

start_dev() {
  stop_all
  echo "▶ режим разработки"
  (cd "$ROOT/apps/engine" && nohup $NO_SLEEP npx tsx watch src/index.ts >>"$RUN/engine.log" 2>&1 & disown)
  (cd "$ROOT/apps/web" && nohup $NO_SLEEP npx next dev -p "$WEB_PORT" >>"$RUN/web.log" 2>&1 & disown)
}

stop_all() {
  pkill -f "tsx src/index.ts" 2>/dev/null
  pkill -f "tsx watch src/index.ts" 2>/dev/null
  pkill -f "next start -p $WEB_PORT" 2>/dev/null
  pkill -f "next dev -p $WEB_PORT" 2>/dev/null
  sleep 1
  echo "остановлено"
}

status() {
  printf "движок :%s  " "$ENGINE_PORT"; is_up "$ENGINE_PORT" /api/health && echo "OK" || echo "НЕ РАБОТАЕТ"
  printf "веб    :%s  " "$WEB_PORT"; is_up "$WEB_PORT" /login && echo "OK" || echo "НЕ РАБОТАЕТ"
  if is_up "$WEB_PORT" /login; then echo "→ http://localhost:$WEB_PORT"; fi
}

watch() {
  echo "сторож запущен (проверка каждые 15 с), лог: $RUN/watch.log"
  while true; do
    if ! is_up "$ENGINE_PORT" /api/health; then
      echo "$(date '+%H:%M:%S') движок упал — поднимаю" >>"$RUN/watch.log"
      start_engine >>"$RUN/watch.log" 2>&1
    fi
    if ! is_up "$WEB_PORT" /login; then
      echo "$(date '+%H:%M:%S') веб упал — поднимаю" >>"$RUN/watch.log"
      start_web >>"$RUN/watch.log" 2>&1
    fi
    sleep 15
  done
}

case "${1:-start}" in
  start) start_engine; start_web; status ;;
  dev) start_dev; sleep 3; status ;;
  stop) stop_all ;;
  restart) stop_all; start_engine; start_web; status ;;
  status) status ;;
  watch) watch ;;
  *) echo "использование: $0 {start|dev|stop|restart|status|watch}" ;;
esac
