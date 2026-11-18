ARG PG_IMAGE=postgres:16-alpine
FROM ${PG_IMAGE}
# aws-cli: yedeklerin isteğe bağlı olarak Cloudflare R2 / S3 uyumlu depoya kopyalanması için
RUN apk add --no-cache aws-cli tzdata
COPY backup.sh /usr/local/bin/backup.sh
COPY loop.sh /usr/local/bin/backup-loop.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/backup-loop.sh
ENTRYPOINT ["/usr/local/bin/backup-loop.sh"]
