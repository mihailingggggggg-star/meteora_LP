#!/usr/bin/env bash
# Установка METEORA TERMINAL из GitHub на VPS одной командой.
#
#   curl -fsSL https://raw.githubusercontent.com/mihailingggggggg-star/meteora_LP/main/deploy/vps-install.sh \
#     | sudo bash -s -- <HELIUS_API_KEY>
#
# Повторный запуск = обновление: код обновляется, .env и база (data/) сохраняются.
set -euo pipefail

REPO="https://github.com/mihailingggggggg-star/meteora_LP"
DST="/opt/meteora-terminal"
HELIUS_KEY="${1:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@meteora.local}"

log() { printf '\033[1;33m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "нужен root: ... | sudo bash -s -- <HELIUS_API_KEY>"
[[ -n "$HELIUS_KEY" ]] || die "передайте ключ Helius: | sudo bash -s -- <HELIUS_API_KEY>"

log "пакеты"
apt-get update -qq
apt-get install -y -qq git curl rsync ca-certificates >/dev/null

# ── код: клонируем или обновляем, не теряя .env и базу
if [[ -d "$DST/.git" ]]; then
  log "обновляю код из GitHub"
  git -C "$DST" fetch --depth 1 origin main >/dev/null
  git -C "$DST" reset --hard origin/main >/dev/null
else
  log "клонирую репозиторий в $DST"
  mkdir -p "$DST"
  if [[ -f "$DST/.env" ]]; then cp -a "$DST/.env" /tmp/meteora.env.keep; fi
  rm -rf "$DST"
  git clone --depth 1 "$REPO" "$DST" >/dev/null
  if [[ -f /tmp/meteora.env.keep ]]; then cp -a /tmp/meteora.env.keep "$DST/.env"; fi
fi

# ── .env: создаём только если его нет (боевые ключи не перезаписываем)
if [[ ! -f "$DST/.env" ]]; then
  log "создаю .env"
  cp "$DST/.env.example" "$DST/.env"
  AUTH="$(openssl rand -base64 48 | tr -d '\n')"
  PASS="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)"
  sed -i -E "s|^HELIUS_API_KEY=.*|HELIUS_API_KEY=$HELIUS_KEY|" "$DST/.env"
  sed -i -E "s|^SOLANA_RPC_URL=.*|SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=$HELIUS_KEY|" "$DST/.env"
  sed -i -E "s|^AUTH_SECRET=.*|AUTH_SECRET=$AUTH|" "$DST/.env"
  sed -i -E "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL|" "$DST/.env"
  sed -i -E "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$PASS|" "$DST/.env"
  sed -i -E "s|^BOT_MODE=.*|BOT_MODE=demo|" "$DST/.env"
  echo "$PASS" > /root/meteora_admin_password.txt
  chmod 600 /root/meteora_admin_password.txt
  chmod 600 "$DST/.env"
fi

mkdir -p "$DST/data" "$DST/journal" "$DST/.run"

log "установка (зависимости, systemd, HTTPS)"
bash "$DST/deploy/install.sh"

PASS="$(grep -E '^ADMIN_PASSWORD=' "$DST/.env" | cut -d= -f2-)"
EMAIL="$(grep -E '^ADMIN_EMAIL=' "$DST/.env" | cut -d= -f2-)"
cat <<EOF

════════════════════════════════════════════════
  METEORA TERMINAL запущен на сервере

  Логин:  $EMAIL
  Пароль: $PASS        (тоже в /root/meteora_admin_password.txt)

  Статус: systemctl status meteora-engine meteora-web
  Логи:   journalctl -u meteora-engine -f
  Обновить: curl -fsSL https://raw.githubusercontent.com/mihailingggggggg-star/meteora_LP/main/deploy/vps-install.sh | sudo bash -s -- <HELIUS_API_KEY>
════════════════════════════════════════════════
EOF
