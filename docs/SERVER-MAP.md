# Карта сервера · 95.179.167.90 (vultr)

> Составлено 27.10.2026 по фактическому состоянию (не по документации проектов).
> Проверять при расхождениях: `ss -ltnp`, `systemctl list-units --state=running`, `pm2 list`.

## Железо и система

| | |
|---|---|
| Хост | `95.179.167.90` (Vultr), hostname `vultr` |
| ОС | Ubuntu 22.04.5 LTS, ядро стабильное, uptime 102 дня |
| RAM | 3.9 ГБ (использовано ~1.9 ГБ) |
| Диск | 75 ГБ, занято 27 ГБ |
| Пользователи | `myuser` (основной, sudo по паролю), `meteora`, `esmar` (system, без логина), `linuxuser` |
| Node | **`/opt/node24/bin/node` v24.21.0** — для meteora и solana_swing. Системный `node v12.22.9` **не трогать** (legacy) |
| Python | 3.10.12 (esmar-bot — свой venv, prometey — свой venv) |
| Веб-сервер | Caddy: `/etc/caddy/Caddyfile` + `solana_swing.caddy`, admin `127.0.0.1:2019` |
| Docker | нет |
| Sudo | `myuser` — по паролю; доступ goose — по ключу `~/.ssh/meteora_ops` (без sudo) |

## Порты

| Порт | Проект | Привязка |
|---|---|---|
| 22 | SSH | `0.0.0.0` |
| 80 / 443 | Caddy | `*` |
| 2019 | Caddy admin | 127.0.0.1 |
| 3000 | **meteora-web** (Next.js) | `*` (доступ только через Caddy) |
| 8789 | **meteora-engine** (API, требует `ENGINE_TOKEN`) | 127.0.0.1 |
| 8787, 8788 | **pump_bot** (автотрейд Bybit) — *удаляется* | 127.0.0.1 |
| 8877 | **prometey** (скринер API) | 127.0.0.1 |
| 8790 | **solana_swing** (vite preview) | 127.0.0.1 |
| 20241 | cloudflared #1 → `:8788` (pump_bot) — *удаляется* | 127.0.0.1 |
| 20242 | cloudflared #2 → `:8877` (prometey) — **оставить** | 127.0.0.1 |
| 53 / 631 | systemd-resolved / cups | — |

Наружу открыты только **22, 80, 443**.

## Домены (Caddy)

| Домен | Куда | Проект |
|---|---|---|
| `lp.95-179-167-90.sslip.io` | `127.0.0.1:3000` + HSTS/CSP/X-Frame-Options | **meteora** |
| `95-179-167-90.sslip.io` | `127.0.0.1:8788` | **pump_bot** — *блок удаляется вместе с ботом* |
| `solana.95-179-167-90.sslip.io` | `127.0.0.1:8790` (из `solana_swing.caddy`) | **solana_swing** |

## Проекты

### 1. meteora-terminal — `/opt/meteora-terminal`
- Юниты: `meteora-engine`, `meteora-web` (оба `User=meteora`, изоляция systemd включена)
- Порты: web 3000, engine 8789; `.env` (600) с `ENGINE_PORT=8789`, `ENGINE_URL=http://127.0.0.1:8789`, `ENGINE_TOKEN` (обязателен для API движка), `AUTH_SECRET` (вход в UI)
- Домен: `lp.95-179-167-90.sslip.io`
- Данные: `data/engine.db`, журнал `journal/*.md` + `events.jsonl`, логи `.run/engine.log` и `.run/web.log`
- Бэкап: cron 03:00 → `deploy/backup.sh` → `data/backups/` (14 копий)
- RAM: ~560 МБ (5 процессов: 2 обёртки `npm exec` + tsx + next-server; можно сократить ~120 МБ)
- Git: `github.com/mihailingggggggg-star/meteora_LP`
- Обновление: `cd /opt/meteora-terminal && sudo git pull && sudo rm -rf apps/web/.next && sudo bash deploy/install.sh`
- Проверка API: `curl -H "Authorization: Bearer $ENGINE_TOKEN" http://127.0.0.1:8789/api/health`

### 2. esmar-bot — `/opt/esmar-bot`
- Юнит `esmar-bot`, `User=esmar`, `python .venv/bin/python bot.py` — **long polling, портов не занимает**
- `.env` (600): `BOT_TOKEN`, `ADMIN_IDS`, `MANAGER_WA_NUMBER`, …; данные в `data/` (SQLite), бэкапы в `backups/`
- Размер 51 МБ, RAM ~105 МБ
- Обновление: `cd /opt/esmar-bot && sudo git pull && sudo systemctl restart esmar-bot`

### 3. prometey (скринер) — `/home/myuser/prometey`
- pm2-приложение `prometey` → `main.py`, автозапуск через `pm2-myuser.service` (`enabled`)
- Порт 8877 (API), публичный доступ — cloudflared-туннель (pid на :20242)
- RAM ~1.0 ГБ, диск: `data/` 3.4 ГБ, `venv/` 194 МБ, `logs/` 58 МБ
- **Не трогать.** Перезапуск: `pm2 restart prometey && pm2 save`
- `/opt/google/chrome` (416 МБ) используется скринером для рендера картинок — **не удалять**

### 4. pump_bot (автотрейд Bybit) — `/home/myuser/prometey/autotrade_bot` — **удалено 27.10.2026**
- Юнит `pump_bot` (`User=myuser`), порты 8787 + 8788, cloudflared #1 → 8788, домен `95-179-167-90.sslip.io` → 8788
- Данные: `data/autotrade.db` 606 МБ + бэкап 104 МБ, venv 272 МБ
- Бэкап перед удалением: `/home/myuser/backups/autotrade_bot-2026-10-27.tar.gz`
- Замечание: офлайн-тулза `prometey/backtest/` ссылается на `autotrade_bot` путями (`BOT_DIR`, `AUTOTRADE`) — после удаления бэктест запускаться не будет; живой скринер от этого не зависит (проверено: импортов нет)

### 5. solana_swing — `/opt/solana_swing`
- Юнит `solana_swing`, `User=myuser`: `server/index.ts` + `vite preview --port 8790`
- Домен: `solana.95-179-167-90.sslip.io`
- Размер 173 МБ

## Мусор / что почистить

| Что | Объём | Решение |
|---|---|---|
| `journald` | 384 МБ | `SystemMaxUse=200M` + `journalctl --vacuum-size=200M` |
| `/etc/caddy/Caddyfile.bak.*` | 16 файлов | оставлять последние 3 |
| `.run/*.log` meteora | append без ротации | logrotate 50 МБ × 3 |
| `prometey/cloudflared.deb` | 19 МБ | можно удалить (пакет уже установлен) |
| `/var/log/auth.log` | 11 МБ | настроен logrotate — ок |

## Правила, чтобы не наступать на грабли

1. **Не занимать 8787/8789 чужими сервисами.** meteora-engine живёт на 8789; при деплое `install.sh` сам подбирает свободный порт и пишет его в `.env` — если порт «уехал», смотреть `ss -ltnp`.
2. **`/opt/meteora-terminal/.env` — 600 и owner `meteora`.** Читать только через `sudo`.
3. **Перед деплоем meteora удалять `apps/web/.next`**, иначе `install.sh` пропустит `next build` и останется старый интерфейс.
4. **Системный node v12 не использовать** — только `/opt/node24/bin/node`.
5. **prometey и chrome не трогать** — на них держится скринер.
6. Все правки в Caddy — только через `caddy validate` + `systemctl reload caddy` (иначе останетесь без HTTPS).
