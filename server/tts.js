// Text-to-speech: listening warm-up audio and the three podcast providers.
//
// Podcast synthesis tries providers in the order the admin configured
// (DashScope Qwen, Gemini 3.1, Gemini 2.5 by default), chunks the script to fit
// each provider's input limit, and concatenates the returned PCM. A provider
// that rate-limits goes into a short cooldown rather than failing the job.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  audioDir,
  dashscopeTtsVoices,
  geminiTtsInputTokenLimit,
  geminiTtsOutputTokenLimit,
  legacyPodcastVoices,
  podcastTtsConcurrency,
  podcastTtsProviderOrder,
} from './config.js'
import { fetchTtsService } from './http.js'
import { chunkTextForTts, estimateTtsInputTokens, mockPodcastPcm, silencePcm, writePodcastAudio } from './audio.js'
import {
  listeningTtsConfig,
  podcastGeminiFallbackConfig,
  podcastGeminiOfficialConfig,
  podcastQwenConfig,
} from './ai-runtime.js'

export const geminiTtsProviderCooldowns = new Map()

export let geminiOfficialTtsCursor = 0

export function defaultPodcastVoice() {
  const configured = String(podcastQwenConfig().voice || '').trim()
  return dashscopeTtsVoices.has(configured) ? configured : 'longanlingxin'
}

export function normalizePodcastVoice(value) {
  const voice = String(value || '').trim()
  return dashscopeTtsVoices.has(voice) ? voice : defaultPodcastVoice()
}

export function normalizePodcastTtsPriority(value) {
  const requested = Array.isArray(value) ? value.map((item) => String(item || '').trim()) : []
  return [...new Set([...requested.filter((item) => podcastTtsProviderOrder.includes(item)), ...podcastTtsProviderOrder])]
}

export function podcastTtsPriority(db) {
  const saved = db?.appSettings?.find((item) => item.id === 'podcast-tts-priority')
  return normalizePodcastTtsPriority(saved?.value)
}

export function savePodcastTtsPriority(db, value) {
  const priority = normalizePodcastTtsPriority(value)
  let setting = db.appSettings.find((item) => item.id === 'podcast-tts-priority')
  const now = new Date().toISOString()
  if (!setting) {
    setting = { id: 'podcast-tts-priority', createdAt: now }
    db.appSettings.push(setting)
  }
  setting.value = priority
  setting.updatedAt = now
  return priority
}

export function buildSpeechAudioRequest(unit) {
  const config = listeningTtsConfig()
  const ttsProvider = config.provider || 'openai-speech'
  const apiKey = config.apiKey
  if ((process.env.AI_PROVIDER || 'auto') === 'mock' || !apiKey) throw new Error('未配置可用的语音生成 API key')

  const input = unit.content?.listening?.text
  if (!input) throw new Error('这个单元还没有听力预热文本')

  const model = config.model
  const voice = resolveTtsVoice(unit.id)
  const baseUrl = config.baseUrl
  const instructions =
    config.instructions ||
    'Read in a natural, professional audiobook style for an adult English learner. Use clear articulation, a warm neutral tone, normal speed, and natural pauses. Do not sound robotic.'
  const outputFormat = ttsProvider === 'mimo' || model.startsWith('mimo-') ? 'wav' : 'mp3'
  const contentType = outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'
  const hash = crypto.createHash('sha256').update([ttsProvider, model, voice, instructions, input, outputFormat].join('\n')).digest('hex').slice(0, 16)
  const filename = `${unit.id}-${hash}.${outputFormat}`
  const audioPath = path.join(audioDir, filename)
  return { ttsProvider, baseUrl, apiKey, model, voice, input, instructions, outputFormat, contentType, hash, audioPath }
}

export async function hasCachedSpeechAudio(request) {
  try {
    await fs.access(request.audioPath)
    return true
  } catch {
    return false
  }
}

export async function generateSpeechAudio(unit, request = buildSpeechAudioRequest(unit)) {
  if (await hasCachedSpeechAudio(request)) return request
  const bytes =
    request.ttsProvider === 'mimo' || request.model.startsWith('mimo-')
      ? await generateMimoSpeech(request)
      : await generateOpenAISpeech(request)

  if (bytes.length < 1000) throw new Error('语音生成返回的音频过小')
  await fs.writeFile(request.audioPath, bytes)
  return request
}

export async function generateOpenAISpeech({ baseUrl, apiKey, model, voice, input, instructions, outputFormat }) {
  const response = await fetchTtsService(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input,
      instructions,
      response_format: outputFormat,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`语音生成失败：${response.status} ${text.slice(0, 240)}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

export async function generateMimoSpeech({ baseUrl, apiKey, model, voice, input, instructions, outputFormat }) {
  const response = await fetchTtsService(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: instructions },
        { role: 'assistant', content: input },
      ],
      audio: {
        format: outputFormat,
        voice,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`MiMo 语音生成失败：${response.status} ${text.slice(0, 240)}`)
  }

  const data = await response.json()
  const encoded = data?.choices?.[0]?.message?.audio?.data
  if (!encoded) throw new Error('MiMo 语音接口没有返回 audio.data')
  return Buffer.from(encoded, 'base64')
}

export function resolveTtsVoice(seed = '') {
  const voices = String(listeningTtsConfig().voice || 'marin')
    .split(',')
    .map((voice) => voice.trim())
    .filter(Boolean)
  if (voices.length <= 1) return voices[0] || 'marin'

  const hash = crypto.createHash('sha256').update(String(seed)).digest()
  return voices[hash[0] % voices.length]
}

export function geminiTtsApiUrl(baseUrl, model) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  const apiBase = normalized.endsWith('/v1beta') ? normalized : `${normalized}/v1beta`
  return `${apiBase}/models/${model}:generateContent`
}

export function geminiTtsProviderKey(provider) {
  return `${provider.name}:${provider.keyId || 'default'}:${provider.model}:${provider.baseUrl}`
}

export function shouldCooldownOfficialGeminiTts(message) {
  return /location is not supported|user location|FAILED_PRECONDITION|RESOURCE_EXHAUSTED|prepayment credits|quota|rate limit|status 429/i.test(
    String(message || '')
  )
}

export function geminiPrimaryTtsLabel(baseUrl) {
  const value = String(baseUrl || '').toLowerCase()
  if (value.includes('yunwu.ai')) return 'Yunwu Gemini 3.1'
  if (value.includes('generativelanguage.googleapis.com')) return '官方 Gemini 3.1'
  return 'Gemini 3.1'
}

export function parseApiKeyList(...values) {
  const keys = values
    .flatMap((value) => String(value || '').split(/[,\s;]+/))
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(keys)]
}

export function apiKeyId(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 10)
}

export function serviceEndpointHost(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ''))
    return url.host
  } catch {
    return String(baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0] || ''
  }
}

export function dashscopeTtsProvider() {
  const config = podcastQwenConfig()
  if (!config.apiKey) return null
  return {
    name: 'dashscope-qwen',
    label: 'DashScope Qwen TTS',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  }
}

export function dashscopeTtsApiUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return `${normalized}/services/audio/tts/SpeechSynthesizer`
}

export function dashscopeAudioUrl(value) {
  const url = new URL(String(value || ''))
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) url.protocol = 'https:'
  return url.toString()
}

export async function requestDashscopeTtsChunk(provider, text, voiceName) {
  const voice = normalizePodcastVoice(voiceName)
  const language = String(process.env.DASHSCOPE_TTS_LANGUAGE || 'en').trim()
  const instruction =
    process.env.DASHSCOPE_TTS_INSTRUCTION ||
    'Warm, calm educational podcast voice; natural pace, clear articulation, brief pauses; read exactly as written.'
  const response = await fetchTtsService(dashscopeTtsApiUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      input: {
        text,
        voice,
        format: 'pcm',
        sample_rate: 24000,
        instruction,
        ...(language ? { language_hints: [language] } : {}),
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${provider.label} 失败：${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json()
  const rawAudioUrl = String(data?.output?.audio?.url || '').trim()
  if (!rawAudioUrl) throw new Error(`${provider.label} 未返回音频地址`)
  const audioUrl = dashscopeAudioUrl(rawAudioUrl)
  const audioResponse = await fetchTtsService(audioUrl, { headers: { Accept: 'application/octet-stream' } })
  if (!audioResponse.ok) throw new Error(`${provider.label} 音频下载失败：${audioResponse.status}`)
  const pcm = Buffer.from(await audioResponse.arrayBuffer())
  if (pcm.length < 600 || pcm.length % 2 !== 0) throw new Error(`${provider.label} 返回的 PCM 音频无效`)
  return {
    pcm,
    provider: provider.label,
    model: provider.model,
    promptProfile: 'qwen-podcast-natural',
    mimeType: audioResponse.headers.get('content-type') || 'audio/L16; rate=24000; channels=1',
    voice,
  }
}

export function geminiTtsPrimaryProviders() {
  const config = podcastGeminiOfficialConfig()
  const officialKeys = parseApiKeyList(config.apiKey)
  const officialBaseUrl = config.baseUrl
  const primaryLabel = geminiPrimaryTtsLabel(officialBaseUrl)
  return officialKeys.map((apiKey, index) => ({
      name: 'official-gemini',
      label: officialKeys.length > 1 ? `${primaryLabel} #${index + 1}` : primaryLabel,
      baseUrl: officialBaseUrl,
      apiKey,
      keyId: apiKeyId(apiKey),
      model: config.model,
      maxInputTokens: geminiTtsInputTokenLimit,
      official: true,
    }))
}

export function geminiTtsFallbackProvider() {
  const config = podcastGeminiFallbackConfig()
  if (!config.apiKey) return null
  return {
    name: 'gemini-fallback',
    label: 'Gemini 2.5',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    maxInputTokens: Number(process.env.GEMINI_TTS_FALLBACK_INPUT_TOKEN_LIMIT || geminiTtsInputTokenLimit),
    official: /generativelanguage\.googleapis\.com/i.test(config.baseUrl),
  }
}

export function rotatedGeminiPrimaryProviders() {
  const providers = geminiTtsPrimaryProviders()
  if (providers.length <= 1) return providers
  const offset = geminiOfficialTtsCursor % providers.length
  geminiOfficialTtsCursor += 1
  return [...providers.slice(offset), ...providers.slice(0, offset)]
}

export function orderedPodcastTtsProviders(priority, { includeQwen = true } = {}) {
  const qwen = dashscopeTtsProvider()
  const primaryProviders = rotatedGeminiPrimaryProviders()
  const fallback = geminiTtsFallbackProvider()
  const providers = []
  for (const id of normalizePodcastTtsPriority(priority)) {
    if (id === 'dashscope-qwen' && includeQwen && qwen) providers.push(qwen)
    if (id === 'official-gemini') providers.push(...primaryProviders)
    if (id === 'gemini-fallback' && fallback) providers.push(fallback)
  }
  const now = Date.now()
  return providers.filter(
    (provider) => provider.name === 'dashscope-qwen' || (geminiTtsProviderCooldowns.get(geminiTtsProviderKey(provider)) || 0) <= now
  )
}

export function podcastTtsProviders(options = {}) {
  return orderedPodcastTtsProviders(options.priority, { includeQwen: !options.preferFallback })
}

export async function requestGeminiTtsChunk(provider, text, voiceName) {
  const instruction = podcastTtsInstruction(provider)
  const input = `${instruction}\n\n${text}`
  const estimatedTokens = estimateTtsInputTokens(input)
  if (estimatedTokens > provider.maxInputTokens) {
    throw new Error(`${provider.label} 文本块超过输入 token 限制：约 ${estimatedTokens}/${provider.maxInputTokens}`)
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-goog-api-key': provider.apiKey,
  }
  if (!provider.official) headers.Authorization = `Bearer ${provider.apiKey}`

  const response = await fetchTtsService(geminiTtsApiUrl(provider.baseUrl, provider.model), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } },
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${provider.label} 失败：${response.status} ${body.slice(0, 200)}`)
  }
  const data = await response.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data || item.inline_data?.data)
  const inlineData = part?.inlineData || part?.inline_data
  if (!inlineData?.data) throw new Error(`${provider.label} 未返回音频数据`)
  return {
    pcm: Buffer.from(inlineData.data, 'base64'),
    provider: provider.label,
    model: provider.model,
    promptProfile: provider.name === 'official-gemini' ? 'gemini-3.1-podcast-director' : 'gemini-tts-fallback-clear',
    mimeType: inlineData.mimeType || inlineData.mime_type || '',
  }
}

export function requestPodcastTtsChunk(provider, text, podcastVoice) {
  if (provider.name === 'dashscope-qwen') return requestDashscopeTtsChunk(provider, text, podcastVoice)
  return requestGeminiTtsChunk(provider, text, process.env.GEMINI_TTS_VOICE || 'Kore')
}

export function podcastTtsInstruction(provider) {
  if (provider?.name === 'official-gemini') {
    return (
      process.env.GEMINI_TTS_31_INSTRUCTIONS ||
      `You are narrating a serious single-host knowledge podcast for an adult Chinese learner of English.
Use a natural, professional audiobook voice: calm, warm, intelligent, and human.
Keep normal speed. Do not slow down artificially, because the material is already adapted for the learner.
Use subtle emphasis for historical, political, and economic concepts, but avoid theatrical acting.
Make sentence endings natural, with small rises for guiding questions and confident falls for conclusions.
Add short, natural pauses after dense ideas, transitions, names, dates, and lists of two or three key points.
Pronounce names, places, and institutions carefully and consistently.
Keep the tone faithful to the source: documentary, thoughtful, and precise. Do not add jokes, extra comments, or new facts.
Read the script exactly as written, but use prosody to make the structure clear.`
    )
  }

  return (
    process.env.GEMINI_TTS_FALLBACK_INSTRUCTIONS ||
    `Read in a clear, natural audiobook style for an adult English learner.
Use normal speed, careful articulation, and natural pauses.
Keep the tone warm, steady, and professional.
Do not sound robotic. Do not add extra words.`
  )
}

export async function podcastTtsChunk(text, voiceName, options = {}) {
  const provider = process.env.AI_PROVIDER || 'auto'
  if (provider === 'mock') return { pcm: mockPodcastPcm(text), provider: 'mock', model: 'mock', mimeType: 'audio/l16; rate=24000; channels=1' }

  const providers = podcastTtsProviders(options)
  if (!providers.length) throw new Error('未配置播客 TTS API key')

  const errors = []
  for (const item of providers) {
    try {
      return await requestPodcastTtsChunk(item, text, voiceName)
    } catch (error) {
      const message = error?.message || String(error)
      errors.push(message)
      if (item.official && shouldCooldownOfficialGeminiTts(message)) {
        geminiTtsProviderCooldowns.set(geminiTtsProviderKey(item), Date.now() + 60 * 60 * 1000)
      }
      console.warn(`Podcast TTS provider failed, trying fallback: ${message}`)
    }
  }
  throw new Error(`播客 TTS 全部来源失败：${errors.join(' | ')}`)
}

export async function synthesizePodcastAudio(podcast, onProgress = async () => undefined, options = {}) {
  const voice = normalizePodcastVoice(podcast.audio?.voice || podcast.voice)
  const chunks = chunkTextForTts(podcast.scriptText || '')
  if (!chunks.length) throw new Error('脚本为空，无法合成')

  const concurrency = Math.max(1, Math.min(4, podcastTtsConcurrency))
  const pcmParts = new Array(chunks.length)
  const usedProviders = new Set()
  const usedModels = new Set()
  const usedPromptProfiles = new Set()
  let cursor = 0
  let done = 0

  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor
      cursor += 1
      const result = await podcastTtsChunk(chunks[index], voice, options)
      pcmParts[index] = result.pcm
      if (result.provider) usedProviders.add(result.provider)
      if (result.model) usedModels.add(result.model)
      if (result.promptProfile) usedPromptProfiles.add(result.promptProfile)
      done += 1
      await onProgress(Math.round((done / chunks.length) * 100), done, chunks.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))

  const gap = silencePcm(120)
  const merged = []
  pcmParts.forEach((part, index) => {
    if (index > 0) merged.push(gap)
    merged.push(part)
  })
  const pcm = Buffer.concat(merged)
  const audioFile = await writePodcastAudio(podcast, pcm)

  return {
    file: audioFile.file,
    format: audioFile.format,
    contentType: audioFile.contentType,
    byteLength: audioFile.byteLength,
    voice,
    provider: Array.from(usedProviders).join(' + '),
    model: Array.from(usedModels).join(' + '),
    promptProfile: Array.from(usedPromptProfiles).join(' + '),
    durationSeconds: audioFile.durationSeconds,
    chunkCount: chunks.length,
    generatedAt: new Date().toISOString(),
  }
}
