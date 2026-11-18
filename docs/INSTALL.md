# Kurulum (Ubuntu 24.04 + Docker)

Bu belge AI Social Factory'nin tek bir Ubuntu 24.04 sunucusuna Docker Compose ile kurulmasını anlatır.

## 1. Sunucu gereksinimleri

| Kaynak | En az | Önerilen |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 80 GB SSD (yerel depolama kullanılacaksa daha fazla) |

Günde 3 video için 2 vCPU yeterlidir: bir 25 sn'lik video 2 çekirdek sınırında yaklaşık 2 dakikada render edilir.

## 2. Docker kurulumu

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # oturumu kapatıp açın
```

Güvenlik duvarı: yalnızca 22, 80 ve 443 açık olmalı.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

## 3. Uygulama

```bash
git clone https://github.com/mesutbyrm/Yapayzekavideo.git /opt/asf && cd /opt/asf
cp .env.example .env
```

`.env` içinde en az şunları doldurun (şifreleri `openssl rand` ile üretin):

```bash
openssl rand -base64 24   # POSTGRES_PASSWORD, REDIS_PASSWORD
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY (tam olarak 32 bayt olmalı)
openssl rand -base64 48   # SESSION_SECRET, MEDIA_SIGNING_SECRET
```

- `DOMAIN`, `APP_URL=https://DOMAIN`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` (ilk yönetici; en az 12 karakter, büyük/küçük harf, rakam)
- Entegrasyon anahtarları (bölüm 6)

Üretim ortamında güvenlik sırları eksikse veya veritabanı adresi varsayılan şifre içeriyorsa web, worker ve scheduler **başlamaz**. Bu bilinçli bir korumadır.

DNS'te `DOMAIN` için sunucunun IP adresine bir A kaydı oluşturun.

```bash
docker compose build
docker compose up -d                       # migration otomatik çalışır
docker compose run --rm migrate ./node_modules/.bin/tsx prisma/seed.ts   # ilk yönetici + ilk marka (bir kez)
```

Seed'den sonra `ADMIN_PASSWORD` satırını `.env`'den silebilirsiniz. Seed varsayılan şifre içermez; şifre verilmezse çalışmaz.

## 4. SSL (Let's Encrypt)

```bash
./scripts/init-ssl.sh sizin@epostaniz.com
```

Nginx sertifika yokken yalnızca HTTP ile açılır, sertifika alındıktan sonra HTTPS'e geçer ve HTTP'yi yönlendirir. `certbot` servisi sertifikayı 12 saatte bir kontrol edip yeniler, nginx de 12 saatte bir yeniden yüklenir.

## 5. Servisler

| Servis | Görev |
|---|---|
| `postgres` | PostgreSQL 16 (kalıcı volume) |
| `redis` | BullMQ kuyrukları (AOF açık, `noeviction`, şifreli) |
| `migrate` | Açılışta `prisma migrate deploy` çalıştırır ve çıkar |
| `web` | Yönetim paneli (Next.js) |
| `api` | Aynı imaj; Nginx `/api/*` isteklerini buraya yönlendirir |
| `worker` | Video üretimi (FFmpeg), platform yayınları, durum kontrolü, analiz, bakım. Bellek/CPU sınırlıdır. |
| `scheduler` | Her dakika yayın saatlerini kontrol eder, üretimi zamanında başlatır |
| `nginx` | TLS, hız sınırı, 300 MB yükleme sınırı, proxy |
| `certbot` | Sertifika yenileme |
| `backup` | Günlük `pg_dump` (+ isteğe bağlı medya arşivi, R2/S3 kopyası), 14 gün saklama |

Günlükler: `docker compose logs -f worker` (JSON; token ve şifreler maskelenir).

Güncelleme:

```bash
git pull && docker compose build && docker compose up -d
```

## 6. Entegrasyonlar

Panelde **API Bağlantıları** sayfası her servisin durumunu gerçek kontrolle gösterir. Eksik anahtar varsa ilgili adım açık bir hata ile atlanır; sahte başarı gösterilmez.

### OpenAI
`OPENAI_API_KEY`. Varsayılan model `gpt-5-mini` (fiyatlar `.env` ile güncellenebilir).

### Google Cloud Text-to-Speech
1. Google Cloud'da bir proje oluşturun ve **Cloud Text-to-Speech API**'yi etkinleştirin.
2. Bir servis hesabı ve JSON anahtarı oluşturun.
3. JSON içeriğini tek satır olarak `GOOGLE_TTS_CREDENTIALS_JSON` değişkenine yazın.

### Pexels / Pixabay
Ücretsiz API anahtarları: `PEXELS_API_KEY`, `PIXABAY_API_KEY`. İkisi de yoksa sistem ücretsiz hareketli grafik sahneleri kullanır.

### Cloudflare R2
Bir bucket ve "Object Read & Write" yetkili API token'ı oluşturun: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Bucket'a özel bir alan adı bağlarsanız `R2_PUBLIC_BASE_URL` yazın; yoksa platformlara süreli imzalı URL verilir.

### Meta (Instagram Reels + Facebook Reels)
1. developers.facebook.com üzerinde **Business** türünde uygulama oluşturun ve "Facebook Login for Business" ekleyin.
2. Geçerli OAuth yönlendirme URI'si: `https://DOMAIN/api/oauth/meta/callback`
3. İzinler: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `business_management`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`.
4. Instagram hesabı **Profesyonel** (İşletme/İçerik Üreticisi) olmalı ve bir Facebook Sayfasına bağlı olmalıdır.
5. Canlı kullanım için **App Review** ve **Business Verification** gereklidir. Onaya kadar yalnızca uygulamada rolü olan hesaplar bağlanabilir.

### TikTok (Content Posting API, Direct Post)
1. developers.tiktok.com üzerinde uygulama oluşturun ve **Login Kit** ile **Content Posting API** (Direct Post) ekleyin.
2. Redirect URI: `https://DOMAIN/api/oauth/tiktok/callback`
3. Kapsamlar: `user.info.basic`, `user.info.stats`, `video.publish`, `video.list`.
4. **Denetim (audit) tamamlanana kadar** TikTok yalnızca `SELF_ONLY` (özel) gönderiye izin verir. `TIKTOK_DIRECT_POST_AUDITED=false` iken panel herkese açık seçeneği engeller. Denetimden sonra `true` yapın.
5. TikTok kuralları gereği her yayın, panelde kullanıcı önizleyip gizlilik seviyesini seçerek **onaylandıktan** sonra gönderilir.

### YouTube (Data API v3)
1. Google Cloud'da **YouTube Data API v3**'ü etkinleştirin, OAuth onay ekranını yapılandırın.
2. OAuth istemcisi (Web): yönlendirme URI'si `https://DOMAIN/api/oauth/youtube/callback`
3. Kapsamlar: `youtube.upload`, `youtube.readonly`.
4. Varsayılan kota günde 10.000 birimdir; her yükleme 100 birim kullanır. Denetlenmemiş API projelerinde yüklemeler **özel** moda kilitlenebilir; herkese açık yayın için YouTube API denetimi gerekir.

### E-posta
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_EMAIL`. Kritik bildirimler e-posta ile de gönderilir.

## 7. Yedekleme ve geri yükleme

- Yedekler `./backups` dizinine yazılır (`BACKUP_TIME`, varsayılan 00:30 UTC).
- `BACKUP_S3_*` doldurulursa her yedek R2/S3'e de kopyalanır (sunucu kaybına karşı önerilir).
- Elle yedek: `docker compose exec backup backup.sh`
- Geri yükleme: `./scripts/restore.sh backups/db-<tarih>.dump`

## 8. Geliştirme ortamı (Docker'sız)

```bash
corepack enable && pnpm install
cp .env.example .env    # DATABASE_URL ve REDIS_URL'i yerel servislere göre düzenleyin, NODE_ENV=development
pnpm db:deploy && pnpm db:seed
pnpm dev:web            # http://localhost:3000
pnpm dev:worker
pnpm dev:scheduler
```

Testler:

```bash
createdb asf_test && DATABASE_URL=postgresql://.../asf_test pnpm --filter @asf/core exec prisma migrate deploy
pnpm test                                               # birim + entegrasyon (PostgreSQL + Redis DB 15 + FFmpeg)
E2E_PASSWORD=<yönetici şifresi> pnpm test:e2e           # panel uçtan uca (çalışan sunucuya karşı)
```
