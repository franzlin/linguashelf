#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/linguashelf}"
HOST_BACKUP_DIR="${HOST_BACKUP_DIR:-/opt/linguashelf-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
RUN_RESTORE_DRILL="${RUN_RESTORE_DRILL:-1}"

cd "$APP_DIR"

mkdir -p "$HOST_BACKUP_DIR"
chmod 700 "$HOST_BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
suffix=".zip"
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  suffix=".zip.enc"
fi
name="linguashelf-${stamp}${suffix}"
container_path="/app/backups/${name}"
host_path="${HOST_BACKUP_DIR}/${name}"

docker compose exec -T app npm run backup -- "$container_path"
docker compose cp "app:${container_path}" "$host_path"
chmod 600 "$host_path"

if [ "$RUN_RESTORE_DRILL" = "1" ]; then
  drill_name="${name%.zip}.drill.json"
  drill_container_path="/app/backups/${drill_name}"
  drill_host_path="${HOST_BACKUP_DIR}/${drill_name}"
  docker compose exec -T -e DATA_DIR=/tmp/linguashelf-restore-drill app sh -lc "rm -rf /tmp/linguashelf-restore-drill /tmp/linguashelf-restore-drill-before-restore-* && npm run backup:drill -- '${container_path}' '${drill_container_path}'"
  docker compose cp "app:${drill_container_path}" "$drill_host_path"
  chmod 600 "$drill_host_path"
  echo "Restore drill report: $drill_host_path"
fi

find "$HOST_BACKUP_DIR" -type f \( -name 'linguashelf-*.zip' -o -name 'linguashelf-*.zip.enc' \) -mtime "+${RETENTION_DAYS}" -delete
find "$HOST_BACKUP_DIR" -type f -name 'linguashelf-*.drill.json' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup written: $host_path"
