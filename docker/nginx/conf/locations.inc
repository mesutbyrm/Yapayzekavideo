# Ortak yönlendirmeler (HTTP-only ve HTTPS sunucu bloklarında kullanılır)
client_max_body_size 300m;   # medya kütüphanesi yüklemeleri
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Connection "";

location = /api/auth/login {
  limit_req zone=asf_login burst=5 nodelay;
  proxy_pass http://asf_api;
}

# Platformların videoyu çektiği imzalı medya URL'leri ve dosya akışı: büyük yanıtlar, uzun zaman aşımı
location /api/media/ {
  proxy_buffering off;
  proxy_read_timeout 600s;
  proxy_pass http://asf_api;
}

location /api/ {
  limit_req zone=asf_api burst=40 nodelay;
  proxy_read_timeout 300s;
  proxy_request_buffering off;
  proxy_pass http://asf_api;
}

location /_next/static/ {
  proxy_pass http://asf_web;
  expires 365d;
  add_header Cache-Control "public, immutable";
}

location / {
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_pass http://asf_web;
}
