// Whether a given AI capability should consume the caller's rate-limit quota.
//
// Quota is only spent when a real upstream call will happen: in mock mode, or
// with no key configured, the work is local and free, so it must not count
// against the user.
import {
  listeningTtsConfig,
  podcastGeminiFallbackConfig,
  podcastGeminiOfficialConfig,
  podcastQwenConfig,
  textAiConfig,
  textAiConfigured,
} from './ai-runtime.js'

export function shouldRateLimitAiText() {
  return textAiConfigured()
}

export function shouldRateLimitSpeech() {
  return (process.env.AI_PROVIDER || 'auto') !== 'mock' && Boolean(listeningTtsConfig().apiKey)
}

export function shouldRateLimitPodcast() {
  return (
    (process.env.AI_PROVIDER || 'auto') !== 'mock' &&
    Boolean(
      textAiConfig().apiKey ||
        podcastQwenConfig().apiKey ||
        podcastGeminiOfficialConfig().apiKey ||
        podcastGeminiFallbackConfig().apiKey,
    )
  )
}
