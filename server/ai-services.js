// The admin "AI 服务" panel: status cards, the customizable-endpoint summary,
// and the connectivity tests behind each card's 测试 button.
//
// Everything here is read-only with respect to credentials — service messages
// pass through `sanitizeServiceMessage` so an upstream error can never echo a
// key back into the UI or the stored check history.
import { nanoid } from 'nanoid'
import {
  aiRateLimits,
  pdfOcrCommandTimeoutMs,
  pdfOcrDpi,
  pdfOcrEnabled,
  pdfOcrLanguage,
  pdfOcrMaxPages,
  pdfOcrProvider,
  pdfOcrVisionDpi,
  pdfOcrVisionMinWords,
  podcastTtsChunkChars,
  podcastTtsConcurrency,
  podcastTtsProviderLabels,
} from './config.js'
import { fetchTextService } from './http.js'
import { publicServiceConfig, requestTextAi } from './ai-config.js'
import {
  aiServiceConfigCache,
  listeningTtsConfig,
  ocrVisionConfig,
  podcastGeminiFallbackConfig,
  podcastGeminiOfficialConfig,
  podcastQwenConfig,
  textAiConfig,
} from './ai-runtime.js'
import { commandLooksAvailable, shouldUseVisionOcr } from './ocr.js'
import {
  dashscopeTtsProvider,
  defaultPodcastVoice,
  generateMimoSpeech,
  generateOpenAISpeech,
  geminiPrimaryTtsLabel,
  geminiTtsFallbackProvider,
  geminiTtsPrimaryProviders,
  geminiTtsProviderCooldowns,
  geminiTtsProviderKey,
  podcastTtsPriority,
  requestPodcastTtsChunk,
  resolveTtsVoice,
  serviceEndpointHost,
} from './tts.js'

export function sanitizeServiceMessage(message) {
  return String(message || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza***')
    .slice(0, 360)
}

export function serviceCheckFor(db, userId, serviceId) {
  return db.serviceChecks.find((item) => item.userId === userId && item.serviceId === serviceId) || null
}

export function publicServiceCheck(check) {
  if (!check) return null
  return {
    serviceId: check.serviceId,
    status: check.status,
    message: check.message,
    latencyMs: check.latencyMs,
    checkedAt: check.checkedAt,
    provider: check.provider || '',
    model: check.model || '',
    endpointHost: check.endpointHost || '',
    mimeType: check.mimeType || '',
  }
}

export function saveServiceCheck(db, userId, serviceId, result) {
  const now = new Date().toISOString()
  let check = serviceCheckFor(db, userId, serviceId)
  if (!check) {
    check = { id: nanoid(), userId, serviceId, createdAt: now }
    db.serviceChecks.push(check)
  }
  Object.assign(check, {
    status: result.status,
    message: sanitizeServiceMessage(result.message),
    latencyMs: Number(result.latencyMs || 0),
    checkedAt: now,
    provider: result.provider || '',
    model: result.model || '',
    endpointHost: result.endpointHost || '',
    mimeType: result.mimeType || '',
    updatedAt: now,
  })
  return publicServiceCheck(check)
}

export function serviceStatusFrom(configured, check, warning = '') {
  if (!configured) return 'missing'
  if (check?.status === 'ok') return warning ? 'warning' : 'ok'
  if (check?.status === 'failed') return 'failed'
  return warning ? 'warning' : 'configured'
}

export function publicGeminiProvider(provider, role) {
  if (!provider) return null
  const cooldownUntil = geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0
  return {
    role,
    label: provider.label,
    model: provider.model,
    endpointHost: serviceEndpointHost(provider.baseUrl),
    keyId: provider.keyId ? `#${provider.keyId.slice(0, 4)}` : '',
    cooldownUntil: cooldownUntil > Date.now() ? new Date(cooldownUntil).toISOString() : '',
  }
}

export function buildAiServicesPayload(db, userId) {
  const textConfig = textAiConfig()
  const textBaseUrl = textConfig.baseUrl
  const listeningConfig = listeningTtsConfig()
  const ttsBaseUrl = listeningConfig.baseUrl
  const textConfigured = Boolean(textConfig.apiKey) || process.env.AI_PROVIDER === 'mock'
  const listeningTtsConfigured = Boolean(listeningConfig.apiKey) || process.env.AI_PROVIDER === 'mock'
  const priority = podcastTtsPriority(db)
  const qwenProvider = dashscopeTtsProvider()
  const gemini31Providers = geminiTtsPrimaryProviders()
  const gemini25Provider = geminiTtsFallbackProvider()
  const activeFallbackCooldowns = [...gemini31Providers, gemini25Provider].filter(
    Boolean
  ).filter(
    (provider) => (geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0) > Date.now()
  ).length
  const ocrConfig = ocrVisionConfig()
  const visionConfigured = shouldUseVisionOcr()
  const localOcrConfigured = pdfOcrEnabled
  const services = [
    {
      id: 'text-ai',
      title: '文本生成',
      role: '分级阅读、题目、生词解释、播客脚本',
      category: 'text',
      priority: '主服务',
      configured: textConfigured,
      status: serviceStatusFrom(textConfigured, serviceCheckFor(db, userId, 'text-ai')),
      provider: serviceEndpointHost(textBaseUrl),
      model: textConfig.model,
      endpointHost: serviceEndpointHost(textBaseUrl),
      details: [
        textConfig.apiStyle === 'auto' ? '接口：自动适配' : `接口：${textConfig.apiStyle === 'chat' ? 'chat/completions' : 'responses'}`,
        `配置来源：${textConfig.source === 'custom' ? '网页自定义' : '环境变量'}`,
        `生成质量审稿：${process.env.QUALITY_AUDIT_MODE || 'auto'}`,
      ],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'text-ai')),
    },
    {
      id: 'listening-tts',
      title: '听力预热 TTS',
      role: '学习单元里的先听后读音频',
      category: 'audio',
      priority: '独立服务',
      configured: listeningTtsConfigured,
      status: serviceStatusFrom(listeningTtsConfigured, serviceCheckFor(db, userId, 'listening-tts')),
      provider: listeningConfig.provider || 'openai-speech',
      model: listeningConfig.model,
      endpointHost: serviceEndpointHost(ttsBaseUrl),
      details: [
        `音色：${listeningConfig.voice || 'marin'}`,
        `格式：${listeningConfig.provider === 'mimo' || listeningConfig.model.startsWith('mimo-') ? 'WAV' : 'MP3'}`,
        `配置来源：${listeningConfig.source === 'custom' ? '网页自定义' : '环境变量'}`,
      ],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'listening-tts')),
    },
    {
      id: 'podcast-tts-qwen',
      title: 'Qwen 播客 TTS',
      role: 'DashScope 长文本语音合成',
      category: 'audio',
      priority: `第 ${priority.indexOf('dashscope-qwen') + 1} 优先`,
      configured: Boolean(qwenProvider) || process.env.AI_PROVIDER === 'mock',
      status: serviceStatusFrom(Boolean(qwenProvider) || process.env.AI_PROVIDER === 'mock', serviceCheckFor(db, userId, 'podcast-tts-qwen') || serviceCheckFor(db, userId, 'podcast-tts-primary')),
      provider: qwenProvider?.label || 'DashScope Qwen TTS',
      model: qwenProvider?.model || podcastQwenConfig().model,
      endpointHost: serviceEndpointHost(qwenProvider?.baseUrl || podcastQwenConfig().baseUrl),
      details: [
        `音色：${defaultPodcastVoice()}`,
        `格式：24kHz 单声道 PCM`,
        `分块：最多约 ${formatServiceNumber(podcastTtsChunkChars)} 字`,
      ],
      providers: qwenProvider
        ? [{ role: 'podcast', label: qwenProvider.label, model: qwenProvider.model, endpointHost: serviceEndpointHost(qwenProvider.baseUrl), keyId: '', cooldownUntil: '' }]
        : [],
      warning: '',
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'podcast-tts-qwen') || serviceCheckFor(db, userId, 'podcast-tts-primary')),
    },
    {
      id: 'podcast-tts-gemini-31',
      title: 'Gemini 3.1 播客 TTS',
      role: '支持独立排序的 Gemini 语音来源',
      category: 'audio',
      priority: `第 ${priority.indexOf('official-gemini') + 1} 优先`,
      configured: gemini31Providers.length > 0 || process.env.AI_PROVIDER === 'mock',
      status: serviceStatusFrom(gemini31Providers.length > 0 || process.env.AI_PROVIDER === 'mock', serviceCheckFor(db, userId, 'podcast-tts-gemini-31')),
      provider: gemini31Providers[0]?.label || geminiPrimaryTtsLabel(podcastGeminiOfficialConfig().baseUrl),
      model: gemini31Providers[0]?.model || podcastGeminiOfficialConfig().model,
      endpointHost: serviceEndpointHost(gemini31Providers[0]?.baseUrl || podcastGeminiOfficialConfig().baseUrl),
      details: [`音色：${process.env.GEMINI_TTS_VOICE || 'Kore'}`, `并发：${Math.max(1, Math.min(4, podcastTtsConcurrency))} 块`],
      providers: gemini31Providers.map((provider) => publicGeminiProvider(provider, 'podcast')),
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'podcast-tts-gemini-31')),
    },
    {
      id: 'podcast-tts-gemini-25',
      title: 'Gemini 2.5 播客 TTS',
      role: '支持独立排序的 Gemini 兼容来源',
      category: 'audio',
      priority: `第 ${priority.indexOf('gemini-fallback') + 1} 优先`,
      configured: Boolean(gemini25Provider) || process.env.AI_PROVIDER === 'mock',
      status: serviceStatusFrom(Boolean(gemini25Provider) || process.env.AI_PROVIDER === 'mock', serviceCheckFor(db, userId, 'podcast-tts-gemini-25') || serviceCheckFor(db, userId, 'podcast-tts-fallback')),
      provider: gemini25Provider?.label || 'Gemini 2.5 TTS',
      model: gemini25Provider?.model || podcastGeminiFallbackConfig().model,
      endpointHost: serviceEndpointHost(gemini25Provider?.baseUrl || podcastGeminiFallbackConfig().baseUrl),
      details: [`音色：${process.env.GEMINI_TTS_VOICE || 'Kore'}`, `并发：${Math.max(1, Math.min(4, podcastTtsConcurrency))} 块`],
      providers: gemini25Provider ? [publicGeminiProvider(gemini25Provider, 'podcast')] : [],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'podcast-tts-gemini-25') || serviceCheckFor(db, userId, 'podcast-tts-fallback')),
    },
    {
      id: 'vision-ocr',
      title: 'PDF 视觉 OCR',
      role: '扫描版 PDF 的优先识别来源',
      category: 'ocr',
      priority: 'Hunyuan 优先',
      configured: visionConfigured,
      status: serviceStatusFrom(visionConfigured, serviceCheckFor(db, userId, 'vision-ocr')),
      provider: pdfOcrProvider,
      model: ocrConfig.model,
      endpointHost: serviceEndpointHost(ocrConfig.baseUrl),
      details: [`视觉 DPI：${pdfOcrVisionDpi}`, `最少正文词：${pdfOcrVisionMinWords}`, `最多页数：${pdfOcrMaxPages}`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'vision-ocr')),
    },
    {
      id: 'local-ocr',
      title: '本地 OCR 兜底',
      role: '视觉 OCR 失败后使用 Tesseract',
      category: 'ocr',
      priority: '备用',
      configured: localOcrConfigured,
      status: serviceStatusFrom(localOcrConfigured, serviceCheckFor(db, userId, 'local-ocr')),
      provider: 'tesseract-ocr',
      model: pdfOcrLanguage,
      endpointHost: 'server-local',
      details: [`DPI：${pdfOcrDpi}`, `命令超时：${Math.round(pdfOcrCommandTimeoutMs / 1000)} 秒`],
      lastCheck: publicServiceCheck(serviceCheckFor(db, userId, 'local-ocr')),
    },
  ]
  const configuredCount = services.filter((service) => service.configured).length
  const healthyCount = services.filter((service) => ['ok', 'configured', 'warning'].includes(service.status)).length
  return {
    updatedAt: new Date().toISOString(),
    customConfig: publicServiceConfig(aiServiceConfigCache, process.env),
    podcastTtsPriority: priority.map((id) => ({
      id,
      label: podcastTtsProviderLabels[id],
      configured:
        process.env.AI_PROVIDER === 'mock' ||
        (id === 'dashscope-qwen'
          ? Boolean(qwenProvider)
          : id === 'official-gemini'
            ? gemini31Providers.length > 0
            : Boolean(gemini25Provider)),
    })),
    overview: {
      configured: configuredCount,
      total: services.length,
      healthy: healthyCount,
      activeCooldowns: activeFallbackCooldowns,
      serviceTestLimit: aiRateLimits['service-test'].max,
      serviceTestWindowMinutes: Math.round(aiRateLimits['service-test'].windowMs / 60000),
    },
    services,
  }
}

export function formatServiceNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

export async function testTextAiService() {
  if (process.env.AI_PROVIDER === 'mock') return { message: 'Mock 文本服务可用', provider: 'mock', model: 'mock' }
  const config = textAiConfig()
  if (!config.apiKey) throw new Error('未配置文本生成 API key')
  const result = await requestTextAi(
    config,
    { input: 'Return only the word OK.', maxOutputTokens: 16, reasoningEffort: 'none', verbosity: '' },
    { fetchImpl: fetchTextService, errorLabel: '文本服务' },
  )
  if (!result.text) throw new Error('文本服务未返回内容')
  const dialect = result.apiStyle === 'chat' ? 'chat/completions' : 'responses'
  return {
    message: `文本生成接口可用（${dialect}${config.source === 'custom' ? '，自定义配置' : ''}）`,
    provider: serviceEndpointHost(config.baseUrl),
    model: config.model,
    endpointHost: serviceEndpointHost(config.baseUrl),
  }
}

export async function testListeningTtsService() {
  if (process.env.AI_PROVIDER === 'mock') return { message: 'Mock 听力 TTS 可用', provider: 'mock', model: 'mock' }
  const config = listeningTtsConfig()
  const ttsProvider = config.provider || 'openai-speech'
  const apiKey = config.apiKey
  if (!apiKey) throw new Error('未配置听力预热 TTS API key')
  const model = config.model
  const baseUrl = config.baseUrl
  const outputFormat = ttsProvider === 'mimo' || model.startsWith('mimo-') ? 'wav' : 'mp3'
  const bytes =
    ttsProvider === 'mimo' || model.startsWith('mimo-')
      ? await generateMimoSpeech({
          baseUrl,
          apiKey,
          model,
          voice: resolveTtsVoice('service-test'),
          input: 'This is a short LinguaShelf listening warm-up voice check.',
          instructions: config.instructions || 'Read naturally and clearly.',
          outputFormat,
        })
      : await generateOpenAISpeech({
          baseUrl,
          apiKey,
          model,
          voice: resolveTtsVoice('service-test'),
          input: 'This is a short LinguaShelf listening warm-up voice check.',
          instructions: config.instructions || 'Read naturally and clearly.',
          outputFormat,
        })
  if (bytes.length < 600) throw new Error('听力预热 TTS 返回的音频过小')
  return { message: `听力预热 TTS 可用，返回 ${bytes.length} bytes`, provider: ttsProvider, model, endpointHost: serviceEndpointHost(baseUrl) }
}

export async function testPodcastTtsProvider(provider) {
  if (process.env.AI_PROVIDER === 'mock' && !provider) return { message: 'Mock 播客 TTS 可用', provider: 'mock', model: 'mock', mimeType: 'audio/l16' }
  if (!provider) throw new Error('未配置播客 TTS 来源')
  const result = await requestPodcastTtsChunk(
    provider,
    'Read this short LinguaShelf podcast voice check in a calm, clear, natural teaching voice.',
    defaultPodcastVoice()
  )
  if (result.pcm.length < 600) throw new Error(`${provider.label} 返回的音频过小`)
  return {
    message: `${provider.label} 可用，返回 ${result.pcm.length} bytes`,
    provider: result.provider,
    model: result.model,
    endpointHost: serviceEndpointHost(provider.baseUrl),
    mimeType: result.mimeType,
  }
}

export async function runAiServiceTest(serviceId) {
  const started = Date.now()
  let result
  if (serviceId === 'text-ai') {
    result = await testTextAiService()
  } else if (serviceId === 'listening-tts') {
    result = await testListeningTtsService()
  } else if (serviceId === 'podcast-tts-primary' || serviceId === 'podcast-tts-qwen') {
    result = await testPodcastTtsProvider(dashscopeTtsProvider())
  } else if (serviceId === 'podcast-tts-gemini-31') {
    result = await testPodcastTtsProvider(geminiTtsPrimaryProviders()[0])
  } else if (serviceId === 'podcast-tts-fallback' || serviceId === 'podcast-tts-gemini-25') {
    result = await testPodcastTtsProvider(geminiTtsFallbackProvider())
  } else if (serviceId === 'vision-ocr') {
    if (!shouldUseVisionOcr()) throw new Error('未配置视觉 OCR 来源')
    const ocrConfig = ocrVisionConfig()
    result = {
      message: '视觉 OCR 配置完整；实际识别质量会在上传扫描 PDF 时验证',
      provider: pdfOcrProvider,
      model: ocrConfig.model,
      endpointHost: serviceEndpointHost(ocrConfig.baseUrl),
    }
  } else if (serviceId === 'local-ocr') {
    const tesseractOk = await commandLooksAvailable('tesseract', ['--version'])
    const popplerOk = await commandLooksAvailable('pdftoppm', ['-v'])
    if (!tesseractOk || !popplerOk) throw new Error(`本地 OCR 缺少组件：${!tesseractOk ? 'tesseract ' : ''}${!popplerOk ? 'pdftoppm' : ''}`.trim())
    result = { message: '本地 OCR 组件可用', provider: 'tesseract-ocr', model: pdfOcrLanguage, endpointHost: 'server-local' }
  } else {
    throw new Error('未知服务')
  }
  return {
    status: 'ok',
    latencyMs: Date.now() - started,
    ...result,
  }
}
