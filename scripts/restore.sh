#!/usr/bin/env bash
# Veritabanı yedeğini geri yükler. DİKKAT: mevcut veriler yedektekiyle değiştirilir.
# Kullanım: ./scripts/restore.sh backups/db-20261118T003000Z.dump
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Kullanım: $0 <db-*.dump>}"
[ -f "$FILE" ] || { echo "Dosya yok: $FILE"; exit 1; }
read -r -p "Veritabanı '$FILE' ile değiştirilecek. Devam? (evet/hayır) " ok
[ "$ok" = "evet" ] || exit 1
docker compose stop web api worker scheduler
docker compose exec -T backup sh -c 'pg_restore --clean --if-exists --no-owner -d "$PGDATABASE"' < "$FILE"
docker compose up -d web api worker scheduler
echo "Geri yükleme tamamlandı."
