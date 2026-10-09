#!/bin/sh
set -eu
umask 077
mkdir -p /backups
while true; do
  backup_file="/backups/aulanexo-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  if MYSQL_PWD="$DB_PASSWORD" mysqldump --host=db --user="$DB_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$DB_NAME" > /backups/pending.sql; then
    gzip -c /backups/pending.sql > "$backup_file"
    rm /backups/pending.sql
    find /backups -name 'aulanexo-*.sql.gz' -mtime +30 -delete
    echo "Respaldo completado: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    sleep 86400
  else
    rm -f /backups/pending.sql
    echo 'Falló el respaldo. Nuevo intento en cinco minutos.' >&2
    sleep 300
  fi
done
