# LinguaShelf Backup Drill

这份记录用于确认备份不是“看起来有文件”，而是真的能恢复。

## 自动机制

- 每日备份脚本：`deploy/backup-daily.sh`
- 默认备份目录：`/opt/linguashelf-backups`
- 默认保留天数：14 天
- 默认会在每次备份后执行一次非破坏性恢复演练
- 恢复演练只使用临时 `DATA_DIR`，不会覆盖生产环境的 `/app/data`

## 手动执行

```bash
cd /opt/linguashelf
APP_DIR=/opt/linguashelf HOST_BACKUP_DIR=/opt/linguashelf-backups RETENTION_DAYS=14 RUN_RESTORE_DRILL=1 bash deploy/backup-daily.sh
```

执行成功后应看到两个文件：

- `linguashelf-*.zip`
- `linguashelf-*.drill.json`

`*.drill.json` 中 `ok: true` 表示备份已成功恢复到临时目录，并且恢复后的数据库和文件通过检查。

## 只演练某一个备份

```bash
docker compose cp /opt/linguashelf-backups/linguashelf-YYYYMMDDTHHMMSSZ.zip app:/app/backups/drill.zip
docker compose exec -T -e DATA_DIR=/tmp/linguashelf-restore-drill app sh -lc "rm -rf /tmp/linguashelf-restore-drill* && npm run backup:drill -- /app/backups/drill.zip /app/backups/manual-drill.json"
docker compose cp app:/app/backups/manual-drill.json /opt/linguashelf-backups/manual-drill.json
```

## 完整恢复生产数据

只有在生产数据损坏或迁移服务器时才执行完整恢复。恢复前先保留当前服务器目录和最近备份文件。

```bash
cd /opt/linguashelf
docker compose stop app
docker compose cp /opt/linguashelf-backups/linguashelf-YYYYMMDDTHHMMSSZ.zip app:/app/backups/restore.zip
docker compose run --rm app npm run restore -- /app/backups/restore.zip
docker compose up -d
```

恢复脚本会先把当前 `DATA_DIR` 改名为 `*-before-restore-*`，再写入备份数据。
