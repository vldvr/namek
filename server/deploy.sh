#!/usr/bin/env bash
# Выкатывает сервер «Намёка»: server/deploy.sh <ssh-хост>
# Первый запуск ещё и заводит vhost namek.wkiseven.me, сертификат и ключ модерации.
set -euo pipefail
HOST=${1:?укажи ssh-хост}
DOMAIN=namek.wkiseven.me
cd "$(dirname "$0")/.."

tar -czf - --exclude='*.test.ts' server/package.json server/main.ts server/room.ts server/words.ts server/seed-words.txt \
  server/Dockerfile server/nginx.conf src/engine src/protocol \
  | ssh "$HOST" "mkdir -p /root/namek-server && tar -xzf - -C /root/namek-server"
scp -q server/docker-compose.yml "$HOST":/root/namek-server/docker-compose.yml

ssh "$HOST" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail
cd /root/namek-server
# Ключ модерации создаётся один раз; его же кладём боту модерации.
[ -f .env ] || echo "MOD_KEY=$(openssl rand -hex 24)" > .env
mkdir -p data && chown 1000:1000 data
docker compose up -d --build
for i in $(seq 1 20); do curl -fs 127.0.0.1:8096/health && break; sleep 1; done
echo

SITE=/etc/nginx/sites-available/$DOMAIN
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name %s;\n  location / { return 404; }\n}\n' "$DOMAIN" > "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos
fi
cp server/nginx.conf "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx
echo "ok: https://$DOMAIN"
REMOTE
