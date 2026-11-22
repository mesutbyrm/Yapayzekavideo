# syntax=docker/dockerfile:1.7
# AI Social Factory – tek Dockerfile, iki çalışma imajı:
#   --target web     → Next.js yönetim paneli + API (docker-compose'da "web" ve "api" servisleri)
#   --target worker  → BullMQ worker + scheduler + migration (FFmpeg dahil)
# Çalışma imajları Ubuntu 24.04 tabanlıdır (FFmpeg 6.1, DejaVu/Noto fontları); Node.js resmi imajdan kopyalanır.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=ubuntu:24.04

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- Bağımlılıklar (lockfile ile birebir) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Derleme ---
FROM deps AS build
COPY . .
# Derleme sırasında veritabanına bağlanılmaz; yalnızca yapılandırma doğrulaması için geçici URL
RUN export DATABASE_URL=postgresql://build:build@localhost:5432/build \
 && pnpm --filter @asf/core db:generate \
 && pnpm --filter @asf/web build

# --- Ortak çalışma tabanı: Ubuntu 24.04 + Node.js 22 + FFmpeg/FFprobe + fontlar + root olmayan kullanıcı ---
FROM ${NODE_IMAGE} AS node
FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core ca-certificates tini python3 python3-pil \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --home /app app \
 && mkdir -p /data/storage /data/work && chown -R app:app /data
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "--"]

# --- Web / API ---
FROM runtime AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# --- Worker / Scheduler / Migration ---
FROM runtime AS worker
COPY --from=build --chown=app:app /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/core ./packages/core
COPY --from=build --chown=app:app /app/apps/worker ./apps/worker
USER app
WORKDIR /app/apps/worker
CMD ["./node_modules/.bin/tsx", "src/worker.ts"]
