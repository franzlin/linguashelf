// Read-only admin dashboard: backup freshness, disk usage, job summary,
// AI spend and the warning list.
//
// Aggregation only — nothing here writes, which is what keeps it above the job
// queue and telemetry rather than tangled with them.
import fs from 'node:fs/promises'
import path from 'node:path'
import { audioDir, backupDir, dataDir, dbPath, sqlitePath, storageDriver, uploadDir } from './config.js'
import { formatBytes } from './http.js'
import { computeAiUsageSummary, publicErrorLog } from './telemetry.js'
import { buildAiServicesPayload } from './ai-services.js'
import { diagnoseJobError } from './job-diagnosis.js'
import { publicJobWithContext } from './jobs.js'

export async function computeBackupStatus() {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = path.join(backupDir, entry.name)
          const stat = await fs.stat(fullPath)
          return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, modifiedAt: stat.mtime.toISOString() }
        })
    )
    const backups = files
      .filter((file) => /^linguashelf-.*\.zip(\.enc)?$/.test(file.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const drills = files
      .filter((file) => /^linguashelf-.*\.drill\.json$/.test(file.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    let latestDrill = drills[0] || null
    if (latestDrill) {
      try {
        const report = JSON.parse(await fs.readFile(path.join(backupDir, latestDrill.name), 'utf8'))
        latestDrill = {
          ...latestDrill,
          ok: Boolean(report.ok),
          restoredFiles: Number(report.restoredFiles || 0),
          restoredBytes: Number(report.restoredBytes || 0),
          recordCount: Number(report.recordCount || 0),
        }
      } catch {
        latestDrill = { ...latestDrill, ok: false }
      }
    }
    return {
      configured: true,
      backupDir,
      backupCount: backups.length,
      latestBackup: backups[0] || null,
      latestDrill,
    }
  } catch {
    return {
      configured: false,
      backupDir,
      backupCount: 0,
      latestBackup: null,
      latestDrill: null,
    }
  }
}

export async function fileSizeIfExists(filePath) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

export async function directoryUsage(dir, maxFiles = 2000) {
  let bytes = 0
  let files = 0
  async function walk(current) {
    if (files >= maxFiles) return
    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= maxFiles) return
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          bytes += stat.size
          files += 1
        } catch {
          // Ignore files that disappear during the scan.
        }
      }
    }
  }
  await walk(dir)
  return { bytes, files, truncated: files >= maxFiles }
}

export async function computeStorageUsage() {
  const [uploads, audio, backups] = await Promise.all([
    directoryUsage(uploadDir),
    directoryUsage(audioDir),
    directoryUsage(backupDir),
  ])
  const dbBytes = storageDriver === 'sqlite' ? await fileSizeIfExists(sqlitePath) : await fileSizeIfExists(dbPath)
  const totalBytes = uploads.bytes + audio.bytes + backups.bytes + dbBytes
  return {
    totalBytes,
    dataDir,
    backupDir,
    items: [
      { key: 'database', label: storageDriver === 'sqlite' ? 'SQLite 数据库' : 'JSON 数据库', bytes: dbBytes, files: dbBytes ? 1 : 0 },
      { key: 'uploads', label: '上传原文', ...uploads },
      { key: 'audio', label: '音频缓存', ...audio },
      { key: 'backups', label: '备份文件', ...backups },
    ],
  }
}

export function taskSummary(db, userId) {
  const jobs = db.jobs.filter((job) => job.userId === userId)
  const byStatus = {}
  const byType = {}
  const failedByCode = {}
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1
    byType[job.type] = (byType[job.type] || 0) + 1
    if (job.status === 'failed') {
      const code = job.errorCode || diagnoseJobError(job, job.error || job.message).errorCode || 'unknown'
      failedByCode[code] = (failedByCode[code] || 0) + 1
    }
  }
  return {
    total: jobs.length,
    active: jobs.filter((job) => ['queued', 'running', 'paused'].includes(job.status)).length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    byStatus,
    byType,
    failedByCode,
    recent: jobs
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, 8)
      .map((job) => publicJobWithContext(job, db)),
  }
}

export function buildAdminWarnings(backup, storage, tasks, aiUsage) {
  const warnings = []
  const now = Date.now()
  const latestBackupAt = backup.latestBackup ? Date.parse(backup.latestBackup.modifiedAt) : 0
  if (!backup.latestBackup) {
    warnings.push({ level: 'critical', scope: 'backup', message: '没有检测到可用备份', detail: '请检查每日备份任务是否正常运行。' })
  } else if (Number.isFinite(latestBackupAt) && now - latestBackupAt > 36 * 60 * 60 * 1000) {
    warnings.push({ level: 'warning', scope: 'backup', message: '最近备份超过 36 小时', detail: `最近一次：${backup.latestBackup.modifiedAt}` })
  }
  if (backup.latestBackup && !String(backup.latestBackup.name || '').endsWith('.enc')) {
    warnings.push({ level: 'warning', scope: 'backup', message: '最近备份不是加密文件', detail: '建议确认 BACKUP_ENCRYPTION_REQUIRED=true。' })
  }
  if (!backup.latestDrill) {
    warnings.push({ level: 'warning', scope: 'backup', message: '还没有恢复演练报告', detail: '备份必须能恢复才算真正可用。' })
  } else if (!backup.latestDrill.ok) {
    warnings.push({ level: 'critical', scope: 'backup', message: '最近恢复演练失败', detail: '请优先检查备份脚本和加密密钥。' })
  }
  if (Number(storage.totalBytes || 0) > 20 * 1024 * 1024 * 1024) {
    warnings.push({ level: 'warning', scope: 'storage', message: '数据目录超过 20GB', detail: '需要清理旧音频或扩容磁盘。' })
  }
  if (Number(tasks.failed || 0) > 0) {
    warnings.push({ level: 'warning', scope: 'tasks', message: `有 ${tasks.failed} 个失败任务`, detail: '打开任务中心查看失败原因并按需重试。' })
  }
  for (const warning of aiUsage.warnings || []) {
    warnings.push({ level: warning.level || 'warning', scope: 'ai', message: warning.message, detail: warning.detail || '' })
  }
  return warnings
}

export async function buildAdminStatusPayload(db, userId) {
  const [backup, storage] = await Promise.all([computeBackupStatus(), computeStorageUsage()])
  const services = buildAiServicesPayload(db, userId)
  const tasks = taskSummary(db, userId)
  const aiUsage = computeAiUsageSummary(db, userId)
  const recentErrors = (db.errorLogs || [])
    .filter((log) => !log.userId || log.userId === userId)
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map(publicErrorLog)
  return {
    updatedAt: new Date().toISOString(),
    warnings: buildAdminWarnings(backup, storage, tasks, aiUsage),
    tasks,
    aiUsage,
    backup,
    services: {
      overview: services.overview,
      items: services.services.map((service) => ({
        id: service.id,
        title: service.title,
        status: service.status,
        configured: service.configured,
        provider: service.provider,
        model: service.model,
        endpointHost: service.endpointHost,
        warning: service.warning || '',
        lastCheck: service.lastCheck || null,
      })),
    },
    storage,
    recentErrors,
  }
}
