#!/bin/sh
# Her gün BACKUP_TIME (UTC, SS:DD; varsayılan 00:30 = İstanbul 03:30) saatinde yedek alır.
set -u
TIME="${BACKUP_TIME:-00:30}"
echo "[backup] zamanlayıcı başladı, günlük saat $TIME (UTC)"
while :; do
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) $TIME" +%s 2>/dev/null || date -u -D "%Y-%m-%d %H:%M" -d "$(date -u +%Y-%m-%d) $TIME" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  /usr/local/bin/backup.sh || echo "[backup] HATA: yedekleme başarısız" >&2
done
