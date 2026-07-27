// Live AI service configuration.
//
// The stored config (SQLite appSettings, editable from the admin UI) is cached
// in this module because the AI call sites sit deep in the request path with no
// database handle. `refreshAiServiceConfig` is called at startup and after every
// admin write, so a saved change takes effect without a restart.
import { fetchTextService } from './http.js'
import { readDb } from './storage.js'
import {
  normalizeServiceConfig,
  parseJsonLoose,
  requestTextAi,
  resetEndpointCapabilities,
  resolveListeningTtsConfig,
  resolveOcrConfig,
  resolvePodcastGeminiFallbackConfig,
  resolvePodcastGeminiOfficialConfig,
  resolvePodcastQwenConfig,
  resolveTextConfig,
} from './ai-config.js'

export const aiServiceConfigSettingId = 'ai-service-config'

export let aiServiceConfigCache = {}

export function readStoredAiServiceConfig(db) {
  const saved = db?.appSettings?.find((item) => item.id === aiServiceConfigSettingId)
  return normalizeServiceConfig(saved?.value || {})
}

export function setAiServiceConfigCache(config) {
  aiServiceConfigCache = config || {}
  // A changed endpoint may speak a different dialect than the previous one.
  resetEndpointCapabilities()
  return aiServiceConfigCache
}

export async function refreshAiServiceConfig() {
  try {
    const db = await readDb()
    return setAiServiceConfigCache(readStoredAiServiceConfig(db))
  } catch (error) {
    console.error('failed to load ai service config', error)
    return aiServiceConfigCache
  }
}

export function saveAiServiceConfig(db, patch) {
  const current = readStoredAiServiceConfig(db)
  const incoming = normalizeServiceConfig(patch)
  const next = { ...current }
  for (const [capability, values] of Object.entries(incoming)) {
    next[capability] = { ...(current[capability] || {}) }
    for (const [field, value] of Object.entries(values)) {
      if (value === '' && field !== 'apiKey') delete next[capability][field]
      else if (value === '' && field === 'apiKey') delete next[capability].apiKey
      else next[capability][field] = value
    }
  }

  db.appSettings = Array.isArray(db.appSettings) ? db.appSettings : []
  let setting = db.appSettings.find((item) => item.id === aiServiceConfigSettingId)
  const now = new Date().toISOString()
  if (!setting) {
    setting = { id: aiServiceConfigSettingId, createdAt: now }
    db.appSettings.push(setting)
  }
  setting.value = next
  setting.updatedAt = now
  return setAiServiceConfigCache(next)
}

export function textAiConfig() {
  return resolveTextConfig(aiServiceConfigCache, process.env)
}

export function listeningTtsConfig() {
  return resolveListeningTtsConfig(aiServiceConfigCache, process.env)
}

export function podcastQwenConfig() {
  return resolvePodcastQwenConfig(aiServiceConfigCache, process.env)
}

export function podcastGeminiOfficialConfig() {
  return resolvePodcastGeminiOfficialConfig(aiServiceConfigCache, process.env)
}

export function podcastGeminiFallbackConfig() {
  return resolvePodcastGeminiFallbackConfig(aiServiceConfigCache, process.env)
}

export function ocrVisionConfig() {
  return resolveOcrConfig(aiServiceConfigCache, process.env)
}

export function textAiConfigured() {
  const config = textAiConfig()
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(config.apiKey)
}

export async function callTextAi(request, errorLabel = 'AI 服务') {
  const config = textAiConfig()
  const result = await requestTextAi(config, request, { fetchImpl: fetchTextService, errorLabel })
  return request.schema ? parseJsonLoose(result.text) : result.text
}
