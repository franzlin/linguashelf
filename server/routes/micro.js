import fs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { parseStatusCode } from './../job-diagnosis.js'
import {
  buildMicroPractice,
  microCompletionLocks,
  microPracticeSuggestion,
  microPracticeTypeLabel,
  publicMicroAttempt,
  publicMicroPractice,
  saveMicroVocabularyFromAttempt,
} from './../micro.js'
import { shouldRateLimitAiText, shouldRateLimitSpeech } from './../quota.js'
import { consumeUserQuota } from './../ratelimit.js'
import { computeStats } from './../stats.js'
import { readDb, withKeyedLock, writeDb } from './../storage.js'
import { recordAiUsage, shouldRecordTextAiUsage, textAiUsageSource } from './../telemetry.js'
import { estimateTextTokens } from './../text.js'
import { buildSpeechAudioRequest, generateSpeechAudio, hasCachedSpeechAudio } from './../tts.js'
import { auth } from './../users.js'

export function registerMicroRoutes(app) {
  app.get('/api/micro-practices/recent', auth, async (req, res) => {
    const db = req.db
    const practices = (db.microPractices || [])
      .filter((item) => item.userId === req.user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map(publicMicroPractice)
    const attempts = (db.microAttempts || [])
      .filter((item) => item.userId === req.user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map(publicMicroAttempt)
    res.json({ practices, attempts, stats: computeStats(db, req.user.id) })
  })

  app.post('/api/micro-practices/generate', auth, async (req, res, next) => {
    try {
      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-micro-practice')) return
      const db = req.db
      const practice = await buildMicroPractice(db, req.user.id, req.body || {})
      db.microPractices.push(practice)
      if (shouldRecordTextAiUsage()) {
        const source = textAiUsageSource()
        recordAiUsage(db, {
          userId: req.user.id,
          category: 'text',
          action: 'generate-micro-practice',
          ...source,
          inputTokens: estimateTextTokens(JSON.stringify(req.body || {})),
          outputTokens: estimateTextTokens(JSON.stringify(practice.content || {})),
          success: practice.generatedBy === 'ai',
          message: practice.generatedBy === 'ai' ? '' : practice.error || '每日轻练使用本地兜底',
        })
      }
      await writeDb(db)
      res.json({ practice: publicMicroPractice(practice), stats: computeStats(db, req.user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/micro-practices/:practiceId/complete', auth, async (req, res, next) => {
    try {
      await withKeyedLock(microCompletionLocks, `${req.user.id}:${req.params.practiceId}`, async () => {
        const db = await readDb()
        const practice = (db.microPractices || []).find((item) => item.id === req.params.practiceId && item.userId === req.user.id)
        if (!practice?.content) {
          res.status(404).json({ error: '未找到这次轻练' })
          return
        }

        const existingAttempt =
          (practice.lastAttemptId && (db.microAttempts || []).find((item) => item.id === practice.lastAttemptId && item.userId === req.user.id)) ||
          (db.microAttempts || []).find((item) => item.practiceId === practice.id && item.userId === req.user.id)
        if (existingAttempt) {
          if (practice.status !== 'completed' || practice.lastAttemptId !== existingAttempt.id) {
            practice.status = 'completed'
            practice.completedAt = practice.completedAt || existingAttempt.createdAt
            practice.lastAttemptId = existingAttempt.id
            practice.updatedAt = existingAttempt.createdAt || new Date().toISOString()
            await writeDb(db)
          }
          res.json({
            attempt: publicMicroAttempt(existingAttempt),
            practice: publicMicroPractice(practice),
            stats: computeStats(db, req.user.id),
            duplicate: true,
          })
          return
        }

        const answers = req.body.answers || {}
        const questions = practice.content.questions || []
        const correctCount = questions.filter((question) => Number(answers[question.id]) === Number(question.answerIndex)).length
        const wrongQuestions = questions
          .filter((question) => Number(answers[question.id]) !== Number(question.answerIndex))
          .map((question) => ({
            id: question.id,
            prompt: question.prompt,
            explanationZh: question.explanationZh,
            relatedTerms: question.relatedTerms || [],
          }))
        const correctRate = questions.length ? correctCount / questions.length : 0
        const savedVocabularyCount = saveMicroVocabularyFromAttempt(db, req.user.id, practice, wrongQuestions, Array.isArray(req.body.savedTerms) ? req.body.savedTerms : [])
        const elapsedSeconds = Math.max(0, Number(req.body.elapsedSeconds || 0))
        const fallbackMinutes = practice.type === 'listening' ? 3 : 2
        const studyMinutes = Math.max(1, Math.min(15, Math.round(elapsedSeconds / 60) || fallbackMinutes))
        const attempt = {
          id: nanoid(),
          userId: req.user.id,
          practiceId: practice.id,
          type: practice.type,
          typeLabel: practice.typeLabel || microPracticeTypeLabel(practice.type),
          topic: practice.topic,
          topicLabel: practice.topicLabel,
          difficulty: practice.difficulty,
          sourceMode: practice.sourceMode,
          sourceBookId: practice.sourceBookId || '',
          sourceBookTitle: practice.sourceBookTitle || '',
          correctCount,
          questionCount: questions.length,
          correctRate,
          answers,
          wrongQuestions,
          savedVocabularyCount,
          studyMinutes,
          suggestion: microPracticeSuggestion(correctRate, practice.type, practice.difficulty),
          createdAt: new Date().toISOString(),
        }
        db.microAttempts.push(attempt)
        practice.status = 'completed'
        practice.completedAt = attempt.createdAt
        practice.lastAttemptId = attempt.id
        practice.updatedAt = attempt.createdAt
        await writeDb(db)
        res.json({
          attempt: publicMicroAttempt(attempt),
          practice: publicMicroPractice(practice),
          stats: computeStats(db, req.user.id),
          duplicate: false,
        })
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/micro-practices/:practiceId/audio', auth, async (req, res, next) => {
    try {
      const db = req.db
      const practice = (db.microPractices || []).find((item) => item.id === req.params.practiceId && item.userId === req.user.id)
      if (!practice?.content || practice.type !== 'listening') {
        res.status(404).json({ error: '未找到可播放的听力轻练' })
        return
      }

      const audioUnit = {
        id: `micro-${practice.id}`,
        content: {
          listening: {
            text: practice.content.body,
          },
        },
        audio: practice.audio || null,
      }
      const audioRequest = buildSpeechAudioRequest(audioUnit)
      const cachedAudio = await hasCachedSpeechAudio(audioRequest)
      if (!cachedAudio && shouldRateLimitSpeech() && !consumeUserQuota(req, res, 'speech-audio')) return
      let audio
      try {
        audio = await generateSpeechAudio(audioUnit, audioRequest)
      } catch (error) {
        if (!cachedAudio) {
          recordAiUsage(db, {
            userId: req.user.id,
            category: 'audio',
            action: 'micro-practice-audio',
            provider: audioRequest.ttsProvider,
            model: audioRequest.model,
            inputTokens: estimateTextTokens(audioRequest.input),
            success: false,
            statusCode: parseStatusCode(error.message),
            message: error.message || '轻练听力音频生成失败',
          })
          await writeDb(db).catch((usageError) => console.error('failed to record ai usage', usageError))
        }
        throw error
      }
      if (!cachedAudio) {
        const stat = await fs.stat(audio.audioPath).catch(() => null)
        recordAiUsage(db, {
          userId: req.user.id,
          category: 'audio',
          action: 'micro-practice-audio',
          provider: audio.ttsProvider,
          model: audio.model,
          inputTokens: estimateTextTokens(audio.input),
          audioBytes: stat?.size || 0,
          success: true,
        })
      }
      practice.audio = {
        model: audio.model,
        voice: audio.voice,
        hash: audio.hash,
        format: audio.outputFormat,
        generatedAt: practice.audio?.hash === audio.hash ? practice.audio.generatedAt : new Date().toISOString(),
      }
      practice.updatedAt = new Date().toISOString()
      await writeDb(db)

      res.setHeader('Content-Type', audio.contentType)
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(audio.audioPath)
    } catch (error) {
      next(error)
    }
  })
}
