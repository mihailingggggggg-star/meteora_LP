#!/usr/bin/env bash
# Заливка архива на VPS и установка. Пароль берётся из SSHPASS (не попадает в историю).
#
#   SSHPASS='пароль' bash deploy/push-to-vps.sh myuser@95.179.167.90
#
# Что делает: копирует ~/Desktop/meteora-terminal-<дата>.tar.gz, распаковывает в
# /opt/meteora-terminal, подставляет боевой .env и запускает deploy/install.sh.
set -euo pipefail

TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "usage: SSHPASS='...' bash deploy/push-to-vps.sh user@host"; exit 1; }
[[ -n "${SSHPASS:-}" ]] || { echo "нет SSHPASS"; exit 1; }

cd "$(dirname "$0")/.."
ARCHIVE="$(ls -t "$HOME"/Desktop/meteora-terminal-*.tar.gz 2>/dev/null | head -1)"
[[ -n "$ARCHIVE" ]] || { echo "не найден архив на рабочем столе"; exit 1; }
echo "▶ архив: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

expect - "$TARGET" "$ARCHIVE" "$SSHPASS" <<'EXPECT'
set target [lindex $argv 0]
set archive [lindex $argv 1]
set pass [lindex $argv 2]

log_user 1
set timeout 900

# 1. копируем архив
spawn scp -o StrictHostKeyChecking=no -o ConnectTimeout=20 $archive $target:/tmp/meteora-terminal.tar.gz
expect {
  -re "(?i)password:" { send "$pass\r"; exp_continue }
  eof
}

# 2. распаковка + установка
spawn ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 $target
expect {
  -re "(?i)password:" { send "$pass\r"; exp_continue }
  -re "\\\$ $" { }
  timeout { puts "TIMEOUT на логине"; exit 1 }
}

send "sudo rm -rf /opt/meteora-terminal.new && sudo mkdir -p /opt/meteora-terminal.new && sudo tar -xzf /tmp/meteora-terminal.tar.gz -C /opt/meteora-terminal.new && echo UNPACKED\r"
expect {
  -re "(?i)\\[sudo\\] password" { send "$pass\r"; exp_continue }
  -re "UNPACKED" { }
  timeout { puts "TIMEOUT распаковки"; exit 1 }
}

# сохраняем существующий .env (если он уже настроен), иначе берём боевой шаблон
send "sudo test -f /opt/meteora-terminal/.env && echo HAVE_ENV || sudo cp /opt/meteora-terminal.new/deploy/prod.env /opt/meteora-terminal.new/.env; echo ENV_OK\r"
expect {
  -re "(?i)\\[sudo\\] password" { send "$pass\r"; exp_continue }
  -re "ENV_OK" { }
  timeout { puts "TIMEOUT env"; exit 1 }
}

# переносим код на место (старый каталог — в .bak), .env и data сохраняем
send "sudo bash -c 'cp -a /opt/meteora-terminal/.env /opt/meteora-terminal.new/.env 2>/dev/null; mkdir -p /opt/meteora-terminal.new/data; cp -a /opt/meteora-terminal/data/engine.db /opt/meteora-terminal.new/data/ 2>/dev/null; rm -rf /opt/meteora-terminal.old; mv /opt/meteora-terminal /opt/meteora-terminal.old 2>/dev/null; mv /opt/meteora-terminal.new /opt/meteora-terminal; true' && echo MOVED\r"
expect {
  -re "(?i)\\[sudo\\] password" { send "$pass\r"; exp_continue }
  -re "MOVED" { }
  timeout { puts "TIMEOUT переноса"; exit 1 }
}

send "sudo bash /opt/meteora-terminal/deploy/install.sh 2>&1 | tail -40\r"
expect {
  -re "(?i)\\[sudo\\] password" { send "$pass\r"; exp_continue }
  -re "Проверьте, что 80/443" { }
  -re "\\\$ $" { }
  timeout { puts "TIMEOUT установки (см. лог выше)"; exit 1 }
}
send "exit\r"
expect eof
EXPECT

echo "▶ готово"
