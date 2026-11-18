# Sertifika alınmadan önceki geçici yapılandırma (yalnızca HTTP)
server {
  listen 80;
  server_name __DOMAIN__;

  location /.well-known/acme-challenge/ { root /var/www/certbot; }

  include /etc/nginx/conf.d/asf-locations.inc;
}
