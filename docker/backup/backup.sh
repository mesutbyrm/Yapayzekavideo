#!/bin/sh
# Veritabanı (+ yerel medya) yedeği.
#   BACKUP_RETENTION_DAYS   yerel saklama süresi (varsayılan 14)
#   BACKUP_INCLUDE_MEDIA    true → /data/storage arşivlenir (STORAGE_DRIVER=local ise önerilir)
#   BACKUP_S3_BUCKET        doluysa yedekler S3 uyumlu depoya (ör. R2) kopyalanır
#   BACKUP_S3_ENDPOINT      ör. https://<account_id>.r2.cloudflarestorage.com
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
set -eu
DIR=/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$DIR"

DB_FILE="$DIR/db-$STAMP.dump"
echo "[backup] veritabanı yedeği: $DB_FILE"
pg_dump --format=custom --compress=9 --no-owner --file="$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"
pg_restore --list "$DB_FILE" > /dev/null   # yedeğin okunabilirliğini doğrula

FILES="$DB_FILE"
if [ "${BACKUP_INCLUDE_MEDIA:-false}" = "true" ] && [ -d /data/storage ]; then
  MEDIA_FILE="$DIR/media-$STAMP.tar.gz"
  echo "[backup] medya arşivi: $MEDIA_FILE"
  tar -czf "$MEDIA_FILE.partial" -C /data storage
  mv "$MEDIA_FILE.partial" "$MEDIA_FILE"
  FILES="$FILES $MEDIA_FILE"
fi

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:?}"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:?}"
  export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"
  for f in $FILES; do
    echo "[backup] uzak kopya: $(basename "$f")"
    aws s3 cp "$f" "s3://${BACKUP_S3_BUCKET}/backups/$(basename "$f")" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} --only-show-errors
  done
fi

echo "[backup] $RETENTION günden eski yerel yedekler temizleniyor"
find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) -mtime +"$RETENTION" -print -delete
echo "[backup] tamamlandı"
