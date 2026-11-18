#!/usr/bin/env bash
# İlk Let's Encrypt sertifikasını alır (webroot yöntemi), ardından nginx'i HTTPS ile yeniden başlatır.
# Kullanım: ./scripts/init-ssl.sh admin@ornek.com
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?Kullanım: $0 <letsencrypt-eposta>}"
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
[ -n "$DOMAIN" ] || { echo ".env içinde DOMAIN tanımlı değil"; exit 1; }

docker compose up -d nginx
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
docker compose restart nginx
echo "HTTPS hazır: https://$DOMAIN"
