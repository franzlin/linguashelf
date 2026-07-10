export function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队',
    running: '运行',
    paused: '暂停',
    failed: '失败',
    canceled: '取消',
    succeeded: '完成',
  }
  return labels[status] || status
}

export function jobTypeLabel(type: string) {
  const labels: Record<string, string> = {
    'generate-unit': '分级阅读',
    'generate-podcast': '播客',
    'parse-pdf-ocr': 'PDF OCR',
  }
  return labels[type] || type
}

export function errorCodeLabel(code: string) {
  const labels: Record<string, string> = {
    'provider-auth': '配置问题',
    'rate-limit': '限流/额度',
    'upstream-temporary': '上游临时错误',
    'ocr-failed': 'OCR 失败',
    'quality-review': '质量复核',
    'bad-request': '请求被拒绝',
    'missing-resource': '资源缺失',
    'server-error': '服务器错误',
    unknown: '未知错误',
  }
  return labels[code] || code
}
