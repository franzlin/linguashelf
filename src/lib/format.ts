export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

export function formatDecimal(value: number) {
  return Number(value || 0).toFixed(1)
}

export function shortDate(value: string) {
  if (!value) return ''
  const [, month, day] = value.split('-')
  return month && day ? `${Number(month)}/${Number(day)}` : value
}

export function levelPercent(options: string[], value: string) {
  const index = Math.max(0, options.indexOf(value))
  if (options.length <= 1) return 0
  return Math.round((index / (options.length - 1)) * 100)
}

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0))
  const minutes = Math.floor(safe / 60)
  const rest = String(safe % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

export function formatBytes(bytes?: number) {
  const value = Number(bytes || 0)
  if (!value) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function formatTokenCount(tokens?: number) {
  const value = Number(tokens || 0)
  if (!value) return '0'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(Math.round(value))
}

export function aiUsageActionLabel(action: string) {
  const labels: Record<string, string> = {
    'generate-unit': '分级单元',
    'define-word': '单词释义',
    'speech-audio': '听力音频',
    'generate-podcast-script': '播客脚本',
    'generate-podcast-tts': '播客 TTS',
    'pdf-ocr': 'PDF OCR',
  }
  return labels[action] || action
}

export function formatDateTime(value?: string | null) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}
