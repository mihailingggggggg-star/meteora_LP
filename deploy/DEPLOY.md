# Деплой на VPS

Постоянная ссылка **без покупки домена** — через `sslip.io` + Caddy (та же схема, что в проекте «Прометей автотрейд»).
Если есть свой домен — просто передайте его аргументом, Caddy выпустит сертификат сам.

## 1. Что нужно

- VPS Ubuntu 22.04/24.04, **2 ГБ RAM** (движок + Next.js), 10 ГБ диска
- открытые порты **80** и **443** (для Let's Encrypt и сайта)
- `.env` с ключами (Helius, AUTH_SECRET, ADMIN_EMAIL/PASSWORD) — он в git не попадает

## 2. Установка одной командой

```bash
# на локальной машине: залить код на сервер (любой способ), затем на сервере:
cd /opt/meteora-terminal          # или куда скопировали
cp .env.example .env && nano .env # HELIUS_API_KEY, AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
sudo bash deploy/install.sh       # без аргумента → lp.<IP>.sslip.io
# или со своим доменом:
sudo bash deploy/install.sh app.mydomain.com
```

Скрипт сам: ставит Node 22 и Caddy, создаёт пользователя `meteora`, копирует проект в `/opt/meteora-terminal`,
собирает, поднимает два systemd-юнита, настраивает HTTPS и печатает готовую ссылку.

## 3. Что где живёт

| Компонент | Порт | Юнит |
|---|---|---|
| Движок (скринер, модель, исполнение, WS) | `127.0.0.1:8787` | `meteora-engine` |
| Веб-интерфейс (Next.js) | `127.0.0.1:3000` | `meteora-web` |
| Caddy (HTTPS-терминация) | 80/443 | `caddy` |

Движок наружу **не смотрит** — только через веб.

## 4. Эксплуатация

```bash
systemctl status meteora-engine meteora-web
journalctl -u meteora-engine -f
journalctl -u meteora-web -f
tail -f /opt/meteora-terminal/.run/engine.log
tail -f /opt/meteora-terminal/journal/$(date +%F).md
```

**Обновление кода:**

```bash
cd /opt/meteora-terminal
git pull
npm install
npm run build
sudo systemctl restart meteora-web meteora-engine
```

## 5. Важно для бота

- **Данные и журнал живут на сервере** (`data/engine.db`, `journal/`) — при переезде копируйте их.
- **Ключ торгового кошелька** (для боевого контура) храните только в `.env` на сервере; `.env` в git не попадает.
- Демо-контур работает сразу после установки, боевой требует `BOT_MODE=live` и ключа.
- На слабом VPS (1 ГБ) сборка может упасть по памяти: добавьте swap (`fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile`).

## 6. Проверка после установки

```bash
curl -s http://127.0.0.1:8787/api/health          # {"ok":true,"mode":"demo"}
curl -s -o /dev/null -w "%{http_code}\n" https://<ваш-адрес>/login   # 200
```

Дальше заходите по ссылке, входите паролем из `.env` и привязываете Phantom.

## 7. Если что-то не так

| Симптом | Причина | Решение |
|---|---|---|
| `502` от Caddy | веб не поднялся | `journalctl -u meteora-web -n 100` |
| сертификат не выдаётся | закрыт 80 порт / DNS | `ufw allow 80,443/tcp`, проверить `dig <host>` |
| движок падает на старте | нет `.env` или битый ключ | `journalctl -u meteora-engine -n 80` |
| пустой скринер | гейты слишком строгие | `.env`: `MIN_TURNOVER_DAILY_PCT`, `MIN_TURNOVER_HOURLY_PCT` |
