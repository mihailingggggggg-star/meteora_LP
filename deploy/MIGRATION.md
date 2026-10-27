# Перенос на VPS (95.179.167.90)

Один скрипт: архив → распаковка → боевой `.env` → установка → systemd → HTTPS.

```bash
# на маке (пароль не попадёт в history благодаря переменной окружения)
cd ~/Desktop/meteora-terminal
SSHPASS='пароль_myuser' bash deploy/push-to-vps.sh myuser@95.179.167.90
```

Скрипт делает:
1. `scp` архива `~/Desktop/meteora-terminal-<дата>.tar.gz` в `/tmp`;
2. распаковку в `/opt/meteora-terminal.new`, перенос старого `.env` и `data/engine.db`;
3. `deploy/install.sh` — зависимости, systemd-юниты, HTTPS-адрес.

### Что учитывает установщик (сервер общий с esmar-bot)

* **порты** — берёт 3000/8787, а если они заняты, уходит на 3001/8788 и правит `.env` + юниты;
* **Caddy/nginx не ломает** — если на сервере уже стоит Caddy, дописывает свой site-блок в конец
  `Caddyfile` (с бэкапом); если nginx — создаёт отдельный `sites-enabled/meteora-terminal`;
* **не собирает Next на сервере** — в архиве лежит готовая сборка `.next`, поэтому хватает
  `npm install` (важно для 2 ГБ RAM, иначе `next build` уходит в swap);
* **наружу смотрят только 80/443** — веб и движок слушают `127.0.0.1`.

### Проверка после установки

```bash
systemctl status meteora-engine meteora-web
curl -s http://127.0.0.1:8787/api/health
tail -f /opt/meteora-terminal/.run/engine.log
```

Ссылка: `https://lp.95-179-167-90.sslip.io` (домен не нужен, сертификат Let's Encrypt выдаётся
автоматически на этот хост).

### Обновление кода в дальнейшем

```bash
RSYNC: rsync -az --exclude node_modules --exclude .git --exclude data ~/Desktop/meteora-terminal/ myuser@95.179.167.90:/tmp/mt/
ssh myuser@95.179.167.90
sudo rsync -a --exclude node_modules --exclude data /tmp/mt/ /opt/meteora-terminal/
sudo -u meteora bash -lc 'cd /opt/meteora-terminal && npm install && npm run build'
sudo systemctl restart meteora-engine meteora-web
```

---

# Перенос вручную (без скрипта)

```bash
scp ~/Desktop/meteora-terminal-<дата>.tar.gz myuser@95.179.167.90:/tmp/
ssh myuser@95.179.167.90
sudo mkdir -p /opt/meteora-terminal
sudo tar -xzf /tmp/meteora-terminal.tar.gz -C /opt/meteora-terminal
sudo cp /opt/meteora-terminal/deploy/prod.env /opt/meteora-terminal/.env   # если .env ещё нет
sudo bash /opt/meteora-terminal/deploy/install.sh
```
