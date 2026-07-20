import type { GenerationJob } from './domain'

export type SecurityStatus = {
  security: {
    allowSignup: boolean
    inviteRequired: boolean
    sessionDays: number
    loginWindowMinutes: number
    loginMaxFailures: number
  }
  deployment: {
    nodeEnv: string
    storageDriver: string
    dataDir: string
    backupDir: string
    backup: {
      configured: boolean
      backupDir: string
      backupCount: number
      latestBackup: {
        name: string
        size: number
        modifiedAt: string
      } | null
      latestDrill: {
        name: string
        size: number
        modifiedAt: string
        ok?: boolean
        restoredFiles?: number
        restoredBytes?: number
        recordCount?: number
      } | null
    }
    trustProxy: boolean
    aiConfigured: boolean
    ttsConfigured: boolean
    ttsProvider: string
    podcastTtsConfigured: boolean
    podcastTtsPrimary?: string
    podcastTtsInputTokenLimit?: number
    podcastTtsOutputTokenLimit?: number
    podcastTtsChunkTokens?: number
    podcastTtsChunkChars?: number
    maxUnitsPerBook: number
    maxPodcastEpisodes: number
    maxActivePodcastJobs: number
    pdfOcrEnabled: boolean
    pdfOcrProvider: string
    pdfOcrVisionConfigured: boolean
    pdfOcrVisionModel: string
    pdfOcrLanguage: string
    pdfOcrDpi: number
    pdfOcrVisionDpi: number
    pdfOcrMaxPages: number
    activeJobs: number
  }
}

export type AiServiceCheck = {
  serviceId: string
  status: 'ok' | 'failed'
  message: string
  latencyMs: number
  checkedAt: string
  provider?: string
  model?: string
  endpointHost?: string
  mimeType?: string
}

export type AiService = {
  id: string
  title: string
  role: string
  category: 'text' | 'audio' | 'ocr'
  priority: string
  configured: boolean
  status: 'ok' | 'configured' | 'warning' | 'failed' | 'missing'
  provider: string
  model: string
  endpointHost: string
  details: string[]
  warning?: string
  providers?: Array<{
    role: string
    label: string
    model: string
    endpointHost: string
    keyId?: string
    cooldownUntil?: string
  }>
  lastCheck?: AiServiceCheck | null
}

export type PodcastTtsProviderId = 'dashscope-qwen' | 'official-gemini' | 'gemini-fallback'

export type AiServicesPayload = {
  updatedAt: string
  podcastTtsPriority: Array<{
    id: PodcastTtsProviderId
    label: string
    configured: boolean
  }>
  overview: {
    configured: number
    total: number
    healthy: number
    activeCooldowns: number
    serviceTestLimit: number
    serviceTestWindowMinutes: number
  }
  services: AiService[]
}

export type AdminStatus = {
  updatedAt: string
  warnings: Array<{
    level: 'warning' | 'critical' | string
    scope: string
    message: string
    detail?: string
  }>
  tasks: {
    total: number
    active: number
    failed: number
    byStatus: Record<string, number>
    byType: Record<string, number>
    failedByCode: Record<string, number>
    recent: GenerationJob[]
  }
  backup: SecurityStatus['deployment']['backup']
  services: {
    overview: AiServicesPayload['overview']
    items: Array<{
      id: string
      title: string
      status: AiService['status']
      configured: boolean
      provider: string
      model: string
      endpointHost: string
      warning?: string
      lastCheck?: AiServiceCheck | null
    }>
  }
  aiUsage: {
    today: UsageSummary
    sevenDays: UsageSummary
    thirtyDays: UsageSummary
    byAction: Array<UsageSummary & { key: string }>
    byProviderModel: Array<UsageSummary & { key: string }>
    recentFailures: Array<{
      action: string
      provider: string
      model: string
      message: string
      errorCode?: string
      statusCode?: number | null
      createdAt: string
    }>
    warnings: Array<{
      level: string
      message: string
      detail?: string
    }>
  }
  storage: {
    totalBytes: number
    dataDir: string
    backupDir: string
    items: Array<{
      key: string
      label: string
      bytes: number
      files: number
      truncated?: boolean
    }>
  }
  recentErrors: Array<{
    id: string
    level: string
    scope: string
    message: string
    detail: string
    jobId?: string
    unitId?: string
    podcastId?: string
    statusCode?: number | null
    errorCode?: string
    createdAt: string
  }>
}

export type UsageSummary = {
  calls: number
  failed: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  audioBytes: number
  pages: number
  bytes: number
  chunks: number
}
