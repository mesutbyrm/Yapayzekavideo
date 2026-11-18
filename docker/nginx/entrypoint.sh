#!/bin/sh
# Sertifika varsa HTTPS yapılandırmasını, yoksa yalnızca HTTP + ACME doğrulama yapılandırmasını kullanır.
# Sertifika yenilemelerini almak için nginx 12 saatte bir yeniden yüklenir.
set -eu
: "${DOMAIN:?DOMAIN tanımlı değil}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
mkdir -p /etc/nginx/conf.d
rm -f /etc/nginx/conf.d/default.conf
cp /opt/asf-nginx/locations.inc /etc/nginx/conf.d/asf-locations.inc

if [ -f "$CERT" ]; then
  sed "s/__DOMAIN__/${DOMAIN}/g" /opt/asf-nginx/https.conf.tpl > /etc/nginx/conf.d/asf.conf
  echo "nginx: HTTPS etkin (${DOMAIN})"
else
  sed "s/__DOMAIN__/${DOMAIN}/g" /opt/asf-nginx/http.conf.tpl > /etc/nginx/conf.d/asf.conf
  echo "nginx: sertifika bulunamadı, yalnızca HTTP. scripts/init-ssl.sh ile sertifika alın."
fi

( while :; do sleep 12h; nginx -s reload || true; done ) &
exec nginx -g 'daemon off;'
