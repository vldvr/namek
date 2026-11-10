#!/usr/bin/env bash
# Выкатывает бота модерации на nether: server/modbot/deploy.sh [ssh-хост]
# Перед первым запуском на сервере нужен /root/namek-modbot/.env:
#   TELEGRAM_BOT_TOKEN=...   (новый бот из BotFather)
#   ADMIN_CHAT_ID=...        (твой chat id)
#   MOD_KEY=...              (тот же, что в /root/namek-server/.env на russia)
set -euo pipefail
HOST=${1:-nether}
cd "$(dirname "$0")"
tar -czf - bot.mjs Dockerfile docker-compose.yml | ssh "$HOST" "mkdir -p /root/namek-modbot && tar -xzf - -C /root/namek-modbot"
ssh "$HOST" 'cd /root/namek-modbot && test -f .env || { echo "нет /root/namek-modbot/.env"; exit 1; }; docker compose up -d --build && sleep 3 && docker logs --tail 5 namek-modbot'
