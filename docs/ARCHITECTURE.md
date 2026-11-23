# Mimari

## Depo yapısı

```
packages/core   İş mantığı (Prisma şeması, içerik/medya/TTS/video/QC, yayın servisleri, kuyruklar, bütçe, analiz)
apps/web        Next.js App Router: yönetim paneli + REST API (/api/*)
apps/worker     BullMQ worker'ları (worker.ts) ve zamanlayıcı (scheduler.ts)
docker/         Nginx, yedekleme
```

## Üretim hattı

```
scheduler (her dakika)
  └─ yayın saatinden leadMinutes önce: limit + bütçe kontrolü → Video(QUEUED) → kuyruk "video-generate"
worker: generateVideo
  1. Konu: kullanılmamış fikir; yoksa OpenAI ile yeni fikirler (yakın tekrar kontrolü)
  2. Senaryo: OpenAI JSON şeması → zod doğrulama → süre doğrulaması → güvenlik (moderasyon + sezgisel) → en fazla 3 deneme
  3. Medya: sağlayıcı sırası (kütüphane → Pexels → Pixabay → AI görsel → hareketli grafik); lisans bilgisi kaydedilir
  4. TTS: Google Cloud TTS, SSML <mark> ile kelime zamanlaması, gerekirse hız ayarı, loudnorm
  5. Montaj: FFmpeg (sahne normalizasyonu, xfade, ASS altyazı, logo, müzik ducking, -14 LUFS, H.264 High/AAC, faststart)
  6. Kalite kontrol: 16 kontrol; başarısız video kuyruğa ALINMAZ
  7. Depolama (R2 veya yerel) → yayın işleri (hesap başına ayrı PublishJob)
```

### Video şablonları

Marka ayarındaki **Video şablonu** montaj stilini seçer:

- `modern` (varsayılan): geçişli sahneler, kutulu başlık ve altyazı.
- `shorts3d`: "Yapay Zekâ Komedisi" referans videolarının stili (`packages/core/src/video/shorts-style.ts`). Üstte seri adı ve "BÖLÜM N" hapı, ilk ~3 sn iki satırlık kapak başlığı (2. satır kırmızı), y≈1340'ta 1-3 kelimelik kalın siyah konturlu BÜYÜK HARF altyazı (anahtar kelimeler sarı, uyarı kelimeleri kırmızı), sahne etiketi hapı (ör. "2017 · MIT"), bokeh ışıkları, altta ilerleme çubuğu, kapanışta "TAKİP ET!" + "Bölüm N+1 yakında!". Görseller için `AI_IMAGES_ENABLED=true` ise sahne başına sevimli 3D karakter/nesne üretilir (stok videodan önce denenir); kapalıysa ücretsiz parlak arka plan üzerinde vektör robot maskot kullanılır. Senaryo bu şablonda esprili "biliyor muydunuz" anlatımı, `cover_title`, `highlight_words`, `alert_words` ve sahne `label` alanlarıyla üretilir. Referansla aynı uzunluk için marka süresini 50-62 sn yapın. Yazı tipi: paketle gelen Montserrat (SIL OFL, `packages/core/assets/fonts`, `FONTS_DIR` ile değiştirilebilir).

## Yayınlama

- Her platformun **ayrı kuyruğu** ve hız sınırı vardır (`publish-instagram`, `publish-facebook`, `publish-tiktok`, `publish-youtube`). Bir platformdaki hata diğerlerini durdurmaz.
- `PublishJob.idempotencyKey = videoId:socialAccountId` (benzersiz). Aynı video aynı hesaba ikinci kez gönderilmez; başarılı `PublishResult` varsa iş atlanır.
- Yarıda kalan yüklemeler `externalRef` ile devam eder (IG container, FB video_id, TikTok publish_id, YouTube resumable oturumu / `yt:<id>`).
- Hatalar sınıflandırılır: `auth` (hesap işaretlenir, bildirim), `rate_limit`, `transient` (üstel geri çekilme ile tekrar), `validation`/`policy` (tekrar denenmez).
- Token'lar AES-256-GCM ile şifrelenir (AAD = hesap kimliği); süresi 10 dk içinde dolacaksa otomatik yenilenir.
- TikTok: yayın öncesi creator_info sorgusu, kullanıcı onayı, gizlilik seçimi (varsayılan yok), denetim yoksa yalnızca SELF_ONLY.

## Maliyet

Her ücretli çağrıdan önce `assertCanSpend`, sonra gerçek kullanım ile `recordUsage` (token, karakter, adet). Bütçe sınırına yalnızca değişken üretim maliyetleri sayılır; sınırda ücretli üretim durur, yayınlama sürer. Ayrıca marka ve sistem için günlük/aylık video limitleri vardır.

## Güvenlik

Oturum token'ı DB'de SHA-256 hash, httpOnly/secure/sameSite çerez; CSRF double-submit; Redis tabanlı hız sınırı; 5 hatalı girişte 15 dk kilit; RBAC (Yönetici / marka bazlı Sahip-Editör-İzleyici); denetim kaydı; CSP ve güvenlik başlıkları; imzalı süreli medya URL'leri; log'larda token/şifre maskeleme; üretimde eksik sır varsa servisler başlamaz.
