import { buildAdminStatusPayload, computeBackupStatus } from './../admin-report.js'
import { normalizeServiceConfig } from './../ai-config.js'
import {
  listeningTtsConfig,
  ocrVisionConfig,
  podcastGeminiFallbackConfig,
  podcastGeminiOfficialConfig,
  podcastQwenConfig,
  saveAiServiceConfig,
  textAiConfig,
} from './../ai-runtime.js'
import { buildAiServicesPayload, runAiServiceTest, saveServiceCheck } from './../ai-services.js'
import {
  aiRateLimits,
  allowSignup,
  backupDir,
  dataDir,
  geminiTtsInputTokenLimit,
  geminiTtsOutputTokenLimit,
  loginMaxFailures,
  loginWindowMs,
  maxActivePodcastJobs,
  maxActiveUploadParses,
  maxEpubUploadBytes,
  maxPdfUploadBytes,
  maxPodcastEpisodes,
  maxUploadBytes,
  passwordMinLength,
  passwordPbkdf2Iterations,
  pdfOcrDpi,
  pdfOcrEnabled,
  pdfOcrLanguage,
  pdfOcrMaxPages,
  pdfOcrProvider,
  pdfOcrVisionDpi,
  podcastTtsChunkChars,
  podcastTtsChunkTokens,
  podcastTtsProviderLabels,
  podcastTtsProviderOrder,
  rateLimitWindowMs,
  sessionDays,
  signupInviteCode,
  storageDriver,
} from './../config.js'
import { shouldUseVisionOcr } from './../ocr.js'
import { consumeUserQuota } from './../ratelimit.js'
import { writeDb } from './../storage.js'
import { podcastTtsPriority, savePodcastTtsPriority } from './../tts.js'
import { auth, requireAdmin } from './../users.js'

export function registerAdminRoutes(app) {
  app.get('/api/security/status', auth, requireAdmin, async (req, res) => {
    const db = req.db
    const activeJobs = db.jobs.filter((job) => job.userId === req.user.id && ['queued', 'running'].includes(job.status)).length
    const backup = await computeBackupStatus()
    res.json({
      security: {
        allowSignup,
        inviteRequired: Boolean(signupInviteCode),
        sessionDays,
        loginWindowMinutes: Math.round(loginWindowMs / 60000),
        loginMaxFailures,
        passwordMinLength,
        passwordPbkdf2Iterations,
      },
      deployment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        storageDriver,
        dataDir,
        backupDir,
        backup,
        trustProxy: Boolean(process.env.TRUST_PROXY),
        aiConfigured: Boolean(textAiConfig().apiKey),
        ttsConfigured: Boolean(listeningTtsConfig().apiKey),
        ttsProvider: listeningTtsConfig().provider || 'openai-speech',
        podcastTtsConfigured: Boolean(
          podcastQwenConfig().apiKey || podcastGeminiOfficialConfig().apiKey || podcastGeminiFallbackConfig().apiKey,
        ),
        podcastTtsPrimary: podcastTtsProviderLabels[podcastTtsPriority(db)[0]],
        podcastTtsInputTokenLimit: geminiTtsInputTokenLimit,
        podcastTtsOutputTokenLimit: geminiTtsOutputTokenLimit,
        podcastTtsChunkTokens,
        podcastTtsChunkChars,
        maxUnitsPerBook: Number(process.env.MAX_UNITS_PER_BOOK || 240),
        maxPodcastEpisodes,
        maxActivePodcastJobs,
        maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024),
        maxActiveUploadParses,
        maxEpubUploadMb: Math.round(maxEpubUploadBytes / 1024 / 1024),
        maxPdfUploadMb: Math.round(maxPdfUploadBytes / 1024 / 1024),
        pdfOcrEnabled,
        pdfOcrProvider,
        pdfOcrVisionConfigured: shouldUseVisionOcr(),
        pdfOcrVisionModel: ocrVisionConfig().model,
        pdfOcrLanguage,
        pdfOcrDpi,
        pdfOcrVisionDpi,
        pdfOcrMaxPages,
        rateLimitWindowMinutes: Math.round(rateLimitWindowMs / 60000),
        rateLimits: {
          generateUnits: aiRateLimits['generate-unit'].max,
          upload: aiRateLimits.upload.max,
          definitions: aiRateLimits['define-word'].max,
          audio: aiRateLimits['speech-audio'].max,
          podcasts: aiRateLimits['generate-podcast'].max,
          microPractices: aiRateLimits['generate-micro-practice'].max,
          serviceTests: aiRateLimits['service-test'].max,
        },
        activeJobs,
      },
    })
  })

  app.get('/api/ai/services', auth, requireAdmin, async (req, res) => {
    res.json(buildAiServicesPayload(req.db, req.user.id))
  })

  app.patch('/api/ai/services/config', auth, requireAdmin, async (req, res) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {}
    const normalized = normalizeServiceConfig(patch)
    if (!Object.keys(normalized).length) {
      res.status(400).json({ error: '没有可保存的 AI 服务配置' })
      return
    }
    saveAiServiceConfig(req.db, patch)
    await writeDb(req.db)
    res.json(buildAiServicesPayload(req.db, req.user.id))
  })

  app.patch('/api/ai/services/podcast-tts-priority', auth, requireAdmin, async (req, res) => {
    const requested = Array.isArray(req.body.priority) ? req.body.priority : []
    if (
      requested.length !== podcastTtsProviderOrder.length ||
      new Set(requested).size !== podcastTtsProviderOrder.length ||
      requested.some((id) => !podcastTtsProviderOrder.includes(String(id)))
    ) {
      res.status(400).json({ error: '播客 TTS 优先级必须包含全部三个来源' })
      return
    }
    savePodcastTtsPriority(req.db, requested)
    await writeDb(req.db)
    res.json(buildAiServicesPayload(req.db, req.user.id))
  })

  app.post('/api/ai/services/:serviceId/test', auth, requireAdmin, async (req, res) => {
    const serviceId = String(req.params.serviceId || '')
    const known = new Set([
      'text-ai',
      'listening-tts',
      'podcast-tts-primary',
      'podcast-tts-fallback',
      'podcast-tts-qwen',
      'podcast-tts-gemini-31',
      'podcast-tts-gemini-25',
      'vision-ocr',
      'local-ocr',
    ])
    if (!known.has(serviceId)) {
      res.status(404).json({ error: '未知服务' })
      return
    }
    if (!consumeUserQuota(req, res, 'service-test')) return

    let check
    const started = Date.now()
    try {
      check = saveServiceCheck(req.db, req.user.id, serviceId, await runAiServiceTest(serviceId))
    } catch (error) {
      check = saveServiceCheck(req.db, req.user.id, serviceId, {
        status: 'failed',
        message: error?.message || String(error),
        latencyMs: Date.now() - started,
      })
    }
    await writeDb(req.db)
    res.json({ check, ...buildAiServicesPayload(req.db, req.user.id) })
  })

  app.get('/api/admin/status', auth, requireAdmin, async (req, res) => {
    res.json(await buildAdminStatusPayload(req.db, req.user.id))
  })
}
