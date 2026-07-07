#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/linguashelf}"
HOST_BACKUP_DIR="${HOST_BACKUP_DIR:-/opt/linguashelf-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

cd "$APP_DIR"

mkdir -p "$HOST_BACKUP_DIR"
chmod 700 "$HOST_BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="linguashelf-${stamp}.zip"
container_path="/app/backups/${name}"
host_path="${HOST_BACKUP_DIR}/${name}"

docker compose exec -T app npm run backup -- "$container_path"
docker compose cp "app:${container_path}" "$host_path"
chmod 600 "$host_path"

find "$HOST_BACKUP_DIR" -type f -name 'linguashelf-*.zip' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup written: $host_path"
