import { Brain, FileText, Headphones, Volume2 } from 'lucide-react'
import type { AiService } from '../types/admin'

export function aiServiceStatusLabel(status: AiService['status']) {
  const labels: Record<AiService['status'], string> = {
    ok: '已通过',
    configured: '已配置',
    warning: '需关注',
    failed: '失败',
    missing: '未配置',
  }
  return labels[status] || status
}

export function aiServiceStatusClass(status: AiService['status']) {
  if (status === 'ok') return 'completed'
  if (status === 'configured') return 'queued'
  if (status === 'warning') return 'running'
  if (status === 'failed' || status === 'missing') return 'failed'
  return ''
}

export function aiServiceIcon(service: AiService) {
  if (service.id.startsWith('podcast-tts-')) return Headphones
  if (service.id === 'listening-tts') return Volume2
  if (service.category === 'ocr') return FileText
  return Brain
}
