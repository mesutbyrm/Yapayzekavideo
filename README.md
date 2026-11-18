# AI Social Factory

Markalar için günde 3 adet 20–30 saniyelik dikey (1080x1920, H.264/AAC, 30 fps) Türkçe seslendirmeli ve altyazılı video üreten, kalite kontrolünden geçirip Instagram Reels, Facebook Reels, TikTok ve YouTube Shorts'a ayrı ayrı yayınlayan çok markalı SaaS.

- Kurulum: [docs/INSTALL.md](docs/INSTALL.md)
- Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Hızlı başlangıç

```bash
cp .env.example .env      # değerleri doldurun
docker compose up -d --build
docker compose run --rm migrate ./node_modules/.bin/tsx prisma/seed.ts
./scripts/init-ssl.sh sizin@epostaniz.com
```

## Teknoloji

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Recharts · Prisma 7 + PostgreSQL 16 · Redis + BullMQ · FFmpeg · Google Cloud TTS · OpenAI · Pexels/Pixabay · Cloudflare R2 · Docker Compose · Nginx · Let's Encrypt

## Testler

```bash
pnpm test          # birim + entegrasyon (gerçek PostgreSQL/Redis/FFmpeg; dış API'ler MOCK)
pnpm test:e2e      # panel uçtan uca (Playwright)
```
