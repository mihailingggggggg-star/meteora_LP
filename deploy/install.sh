#!/usr/bin/env bash
# Установка METEORA TERMINAL на Ubuntu 20.04/22.04/24.04.
# Запуск:  sudo bash deploy/install.sh [домен]
#   без аргумента — постоянный адрес через sslip.io (домен не нужен)
#
# Что делает:
#   • node 22 (если нет), зависимости, сборка (или готовая сборка из архива)
#   • systemd-юниты meteora-engine / meteora-web (автозапуск, рестарт при падении)
#   • HTTPS-адрес: подхватывает уже стоящий Caddy/nginx и НЕ ломает другие сайты
#   • проверяет занятость портов и уводит нас на свободные
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="/opt/meteora-terminal"
DOMAIN="${1:-}"

log() { printf '\033[1;33m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "нужен sudo: sudo bash deploy/install.sh"

# ── 1. зависимости
log "пакеты"
apt-get update -qq
apt-get install -y -qq curl git rsync ca-certificates gnupg debian-keyring debian-archive-keyring \
  apt-transport-https iproute2

# dpkg мог остаться в полуразобранном состоянии после прошлых попыток
dpkg --configure -a >/dev/null 2>&1 || true
apt-get -f install -y >/dev/null 2>&1 || true

# ── node: НЕ трогаем системные пакеты (на сервере могут жить другие боты, которым нужен свой node).
# Если системный node старше 20 — кладём отдельный в /opt/node22 и только им пользуемся.
NODE_DIR=""
if command -v node >/dev/null 2>&1 && [[ "$(node -v | cut -d. -f1 | tr -d v)" -ge 20 ]]; then
  NODE_BIN="$(command -v node)"
  log "node $(node -v) уже есть — использую его"
else
  NODE_VER="v22.11.0"
  case "$(uname -m)" in
    aarch64|arm64) NARCH="arm64" ;;
    *) NARCH="x64" ;;
  esac
  if [[ ! -x /opt/node22/bin/node ]]; then
    log "node $NODE_VER в /opt/node22 (системный nodejs не трогаю)"
    mkdir -p /opt/node22
    curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$NARCH.tar.xz" -o /tmp/node.tar.xz \
      || die "не скачался node — проверьте интернет на сервере"
    tar -xJf /tmp/node.tar.xz -C /opt/node22 --strip-components=1
    rm -f /tmp/node.tar.xz
  fi
  NODE_BIN="/opt/node22/bin/node"
  NODE_DIR="/opt/node22/bin"
  "$NODE_BIN" -v >/dev/null || die "node не запускается"
fi
NPX_BIN="$(dirname "$NODE_BIN")/npx"
[[ -x "$NPX_BIN" ]] || NPX_BIN="$(dirname "$NODE_BIN")/npm"
export PATH="$(dirname "$NODE_BIN"):$PATH"

# ── 2. пользователь и код
log "пользователь meteora"
id meteora >/dev/null 2>&1 || useradd -r -m -d /opt/meteora-terminal -s /bin/bash meteora

if [[ "$SRC" != "$DST" ]]; then
  log "копирую проект в $DST"
  mkdir -p "$DST"
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude .run --exclude "data/*.db-shm" --exclude "data/*.db-wal" \
    "$SRC"/ "$DST"/
fi
mkdir -p "$DST/.run" "$DST/data" "$DST/journal"
touch "$DST/data/.keep"
chown -R meteora:meteora "$DST"
chmod 755 "$DST"

if [[ ! -f "$DST/.env" ]]; then
  cp "$DST/.env.example" "$DST/.env"
  chown meteora:meteora "$DST/.env"
  die "создан $DST/.env из шаблона — заполните HELIUS_API_KEY, AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD и запустите снова"
fi
missing=()
for k in HELIUS_API_KEY AUTH_SECRET ADMIN_EMAIL ADMIN_PASSWORD; do
  val="$(grep -E "^$k=" "$DST/.env" | head -1 | cut -d= -f2- || true)"
  [[ -z "$val" ]] && missing+=("$k")
done
if (( ${#missing[@]} )); then die "в .env не заполнено: ${missing[*]}"; fi

# ── 3. порты: берём свободные, чтобы не столкнуться с другими ботами на сервере
port_busy() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"; }
WEB_PORT="$(grep -E '^WEB_PORT=' "$DST/.env" | head -1 | cut -d= -f2- || true)"; WEB_PORT="${WEB_PORT:-3000}"
ENGINE_PORT="$(grep -E '^ENGINE_PORT=' "$DST/.env" | head -1 | cut -d= -f2- || true)"; ENGINE_PORT="${ENGINE_PORT:-8787}"
for _ in 1 2 3 4 5; do port_busy "$WEB_PORT" && WEB_PORT=$((WEB_PORT + 1)) || break; done
for _ in 1 2 3 4 5; do port_busy "$ENGINE_PORT" && ENGINE_PORT=$((ENGINE_PORT + 1)) || break; done
log "порты: web=$WEB_PORT engine=$ENGINE_PORT"

IP="$(curl -fsS --max-time 10 https://api.ipify.org)"
HOST="${DOMAIN:-lp.${IP//./-}.sslip.io}"

# правим .env под сервер (порт движка, адрес, SIWS)
sed -i -E "s|^ENGINE_PORT=.*|ENGINE_PORT=$ENGINE_PORT|" "$DST/.env"
grep -q '^ENGINE_PORT=' "$DST/.env" || echo "ENGINE_PORT=$ENGINE_PORT" >> "$DST/.env"
sed -i -E "s|^ENGINE_URL=.*|ENGINE_URL=http://127.0.0.1:$ENGINE_PORT|" "$DST/.env"
grep -q '^ENGINE_URL=' "$DST/.env" || echo "ENGINE_URL=http://127.0.0.1:$ENGINE_PORT" >> "$DST/.env"
sed -i -E "s|^APP_URL=.*|APP_URL=https://$HOST|" "$DST/.env"
grep -q '^APP_URL=' "$DST/.env" || echo "APP_URL=https://$HOST" >> "$DST/.env"
sed -i -E "s|^SIWS_DOMAIN=.*|SIWS_DOMAIN=$HOST|" "$DST/.env"
grep -q '^SIWS_DOMAIN=' "$DST/.env" || echo "SIWS_DOMAIN=$HOST" >> "$DST/.env"
sed -i -E "s|^SIWS_URI=.*|SIWS_URI=https://$HOST|" "$DST/.env"
grep -q '^SIWS_URI=' "$DST/.env" || echo "SIWS_URI=https://$HOST" >> "$DST/.env"
chown meteora:meteora "$DST/.env"
chmod 600 "$DST/.env"

# ── 4. зависимости и сборка
# на маленьком VPS next build упирается в память — подстраховываемся swap-файлом
mem_free_mb() { awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo; }
if [[ ! -f "$DST/apps/web/.next/BUILD_ID" ]] && (( $(mem_free_mb) < 1500 )) && (( $(swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{s+=$1} END {printf "%d", s/1024/1024}') < 512 )); then
  log "мало памяти — создаю swap 1 ГБ для сборки"
  fallocate -l 1G /swapfile.meteora 2>/dev/null || dd if=/dev/zero of=/swapfile.meteora bs=1M count=1024 status=none
  chmod 600 /swapfile.meteora && mkswap /swapfile.meteora >/dev/null && swapon /swapfile.meteora || true
fi

if [[ -f "$DST/apps/web/.next/BUILD_ID" ]]; then
  log "зависимости (готовая сборка .next уже есть — next build пропускаю)"
  sudo -u meteora env PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" bash -c "cd $DST && npm install --no-audit --no-fund"
else
  log "зависимости и сборка (2–4 минуты)"
  sudo -u meteora env PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" NODE_OPTIONS=--max-old-space-size=1400 \
    bash -c "cd $DST && npm install --no-audit --no-fund && npm run build"
fi

# ── 5. systemd
log "systemd-юниты"
NODE_PATH_ENV="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
sed -e "s|-p 3000|-p $WEB_PORT|" -e "s|:3000|:$WEB_PORT|" \
    -e "s|ExecStart=/usr/bin/npx|ExecStart=$NPX_BIN|" \
    -e "s|^Environment=NODE_ENV=production|Environment=PATH=$NODE_PATH_ENV\nEnvironment=NODE_ENV=production|" \
    "$DST/deploy/meteora-web.service" > /etc/systemd/system/meteora-web.service
sed -e "s|ENGINE_PORT=8787|ENGINE_PORT=$ENGINE_PORT|" \
    -e "s|ExecStart=/usr/bin/npx|ExecStart=$NPX_BIN|" \
    -e "s|^EnvironmentFile=|Environment=PATH=$NODE_PATH_ENV\nEnvironmentFile=|" \
    "$DST/deploy/meteora-engine.service" > /etc/systemd/system/meteora-engine.service
systemctl daemon-reload
systemctl enable meteora-engine meteora-web >/dev/null
systemctl restart meteora-engine meteora-web

# ── 6. постоянный адрес: не ломаем то, что уже стоит на сервере
log "веб-сервер и HTTPS: https://$HOST"
if systemctl is-active --quiet caddy || [[ -f /etc/caddy/Caddyfile ]]; then
  CF=/etc/caddy/Caddyfile
  [[ -f "$CF" ]] && cp "$CF" "$CF.bak.$(date +%s)"
  if ! grep -q "$HOST" "$CF" 2>/dev/null; then
    cat >> "$CF" <<EOF

# ── meteora-terminal ──
$HOST {
    encode gzip zstd
    reverse_proxy 127.0.0.1:$WEB_PORT
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
EOF
  fi
  caddy validate --config "$CF" >/dev/null 2>&1 || die "Caddyfile невалиден, откатите: cp $CF.bak.* $CF"
  systemctl reload caddy || systemctl restart caddy
elif systemctl is-active --quiet nginx; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null 2>&1 || true
  cat > /etc/nginx/sites-available/meteora-terminal <<EOF
server {
    listen 80;
    server_name $HOST;
    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/meteora-terminal /etc/nginx/sites-enabled/meteora-terminal
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$HOST" --non-interactive --agree-tos -m "$(grep -E '^ADMIN_EMAIL=' "$DST/.env" | cut -d= -f2-)" --redirect >/dev/null 2>&1 \
    || echo "  сертификат не выдан — HTTPS поднимется после открытия 80/443 в файрволе"
else
  log "caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
  cat > /etc/caddy/Caddyfile <<EOF
$HOST {
    encode gzip zstd
    reverse_proxy 127.0.0.1:$WEB_PORT
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
EOF
  systemctl reload caddy || systemctl restart caddy
fi

# ── 7. проверка
log "проверка (до 40 секунд)"
ok=0
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$ENGINE_PORT/api/health" >/dev/null 2>&1 \
     && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
curl -fsS --max-time 5 "http://127.0.0.1:$ENGINE_PORT/api/health" && echo || {
  echo "движок не поднялся, лог:"; tail -25 "$DST/.run/engine.log" 2>/dev/null
}
curl -o /dev/null -s -w "web: %{http_code}\n" --max-time 5 "http://127.0.0.1:$WEB_PORT/login" || true
if (( ok == 0 )); then die "проверка не прошла — смотрите логи"; fi

cat <<EOF

Готово.

  Ссылка:   https://$HOST
  Логин:    $(grep -E '^ADMIN_EMAIL=' "$DST/.env" | cut -d= -f2-)
  Пароль:   из ADMIN_PASSWORD в $DST/.env

  Порты:    web 127.0.0.1:$WEB_PORT · engine 127.0.0.1:$ENGINE_PORT (наружу не открыты)
  Статус:   systemctl status meteora-engine meteora-web
  Логи:     journalctl -u meteora-engine -f
            tail -f $DST/.run/engine.log

  Обновить: cd $DST && git pull && npm install && npm run build && systemctl restart meteora-web meteora-engine

Проверьте, что 80/443 открыты: ufw allow 80,443/tcp
EOF
