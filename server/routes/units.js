import fs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { buildGeneratedContent, generationSettingsFromBody } from './../content.js'
import { parseStatusCode } from './../job-diagnosis.js'
import {
  activeGenerationJob,
  enqueueGenerationJob,
  processJobQueue,
  publicJobWithContext,
} from './../jobs.js'
import { saveUnitVocabularyFromCompletion } from './../micro.js'
import {
  applyGeneratedContent,
  ensureUnitProgress,
  getUnitProgress,
  publicProgress,
  publicUnit,
  saveUnitVersion,
  unitCompletionLocks,
  unitProgressLocks,
} from './../progress.js'
import { adaptiveSuggestion, assessContentQuality } from './../quality.js'
import { shouldRateLimitAiText, shouldRateLimitSpeech } from './../quota.js'
import { consumeUserQuota } from './../ratelimit.js'
import { repairLowQualityParagraphs } from './../repair.js'
import { userSettings } from './../settings.js'
import { applyAdaptiveLeveling } from './../stats.js'
import { readDb, withKeyedLock, writeDb } from './../storage.js'
import { recordAiUsage } from './../telemetry.js'
import { estimateTextTokens } from './../text.js'
import { buildSpeechAudioRequest, generateSpeechAudio, hasCachedSpeechAudio } from './../tts.js'
import { auth } from './../users.js'

export function registerUnitsRoutes(app) {
  app.post('/api/units/:unitId/generate', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book) {
        res.status(404).json({ error: '未找到学习单元' })
        return
      }

      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const generationSettings = generationSettingsFromBody(userSettings(db, req.user.id), req.body)
      const content = await buildGeneratedContent(unit, generationSettings)
      applyGeneratedContent(unit, content, {
        force: req.body.force,
        versionReason: generationSettings.fidelityMode === 'strict' ? 'fidelity-regenerated' : 'regenerated',
      })
      await writeDb(db)
      res.json({ unit: publicUnit(unit, db, req.user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/repair-paragraphs', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book) {
        res.status(404).json({ error: '未找到学习单元' })
        return
      }
      if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
      const requested = Array.isArray(req.body.paragraphs) ? req.body.paragraphs : []
      const settings = generationSettingsFromBody(userSettings(db, req.user.id), req.body)
      const repair = await repairLowQualityParagraphs(unit, settings, requested)
      saveUnitVersion(unit, 'paragraph-repair')
      unit.content = repair.content
      unit.quality = assessContentQuality(unit.content, unit)
      unit.sourceRefs = unit.quality.sourceRefs
      unit.status = 'generated'
      unit.generatedAt = new Date().toISOString()
      unit.generation = {
        ...(unit.generation || {}),
        status: 'succeeded',
        progress: 100,
        message: `已修复阅读第 ${repair.repairedParagraphs.join('、')} 段`,
        finishedAt: unit.generatedAt,
      }
      await writeDb(db)
      res.json({ unit: publicUnit(unit, db, req.user.id), repairedParagraphs: repair.repairedParagraphs })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/generate-job', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }

    if (!activeGenerationJob(db, req.user.id, unit.id) && shouldRateLimitAiText() && !consumeUserQuota(req, res, 'generate-unit')) return
    const job = enqueueGenerationJob(db, req.user.id, unit, userSettings(db, req.user.id), req.body)
    await writeDb(db)
    setTimeout(processJobQueue, 0)
    res.json({ job: publicJobWithContext(job, db), unit: publicUnit(unit, db, req.user.id) })
  })

  app.post('/api/units/:unitId/versions/:versionId/restore', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }
    const versions = Array.isArray(unit.versions) ? unit.versions : []
    const version = versions.find((item, index) => (item.id || `version-${index}`) === req.params.versionId)
    if (!version?.content) {
      res.status(404).json({ error: '未找到这个历史版本' })
      return
    }

    saveUnitVersion(unit, 'restore-point')
    unit.content = version.content
    unit.title = version.title || version.content.title || unit.title
    unit.status = 'generated'
    unit.generatedAt = new Date().toISOString()
    unit.quality = version.quality || assessContentQuality(version.content, unit)
    unit.sourceRefs = unit.quality.sourceRefs
    unit.audio = null
    unit.generation = {
      ...(unit.generation || {}),
      status: 'succeeded',
      progress: 100,
      message: '已恢复历史版本',
      finishedAt: unit.generatedAt,
    }
    await writeDb(db)
    res.json({ unit: publicUnit(unit, db, req.user.id) })
  })

  app.get('/api/units/:unitId/progress', auth, async (req, res) => {
    const db = req.db
    const unit = db.units.find((item) => item.id === req.params.unitId)
    const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
    if (!unit || !book) {
      res.status(404).json({ error: '未找到学习单元' })
      return
    }
    res.json({ progress: publicProgress(getUnitProgress(db, req.user.id, unit.id)) })
  })

  app.patch('/api/units/:unitId/progress', auth, async (req, res, next) => {
    try {
      await withKeyedLock(unitProgressLocks, `${req.user.id}:${req.params.unitId}`, async () => {
        const db = await readDb()
        const unit = db.units.find((item) => item.id === req.params.unitId)
        const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
        if (!unit || !book) {
          res.status(404).json({ error: '未找到学习单元' })
          return
        }
        const progress = ensureUnitProgress(db, req.user.id, unit.id)
        if (Object.prototype.hasOwnProperty.call(req.body, 'paragraphIndex')) {
          const maxParagraph = Math.max(0, (unit.content?.reading?.paragraphs?.length || 1) - 1)
          progress.paragraphIndex = Math.max(0, Math.min(maxParagraph, Number(req.body.paragraphIndex || 0)))
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'listeningCompleted')) progress.listeningCompleted = Boolean(req.body.listeningCompleted)
        if (Object.prototype.hasOwnProperty.call(req.body, 'answers') && typeof req.body.answers === 'object') progress.answers = req.body.answers || {}
        if (Object.prototype.hasOwnProperty.call(req.body, 'completed')) progress.completed = Boolean(req.body.completed)
        progress.updatedAt = new Date().toISOString()
        await writeDb(db)
        res.json({ progress: publicProgress(progress) })
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/units/:unitId/complete', auth, async (req, res, next) => {
    try {
      await withKeyedLock(unitCompletionLocks, `${req.user.id}:${req.params.unitId}`, async () => {
        const db = await readDb()
        const unit = db.units.find((item) => item.id === req.params.unitId)
        const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
        if (!unit || !book || !unit.content) {
          res.status(404).json({ error: '未找到可完成的学习单元' })
          return
        }

        const existingReport = db.reports.find((item) => item.userId === req.user.id && item.unitId === unit.id)
        if (existingReport) {
          const progress = ensureUnitProgress(db, req.user.id, unit.id)
          let changed = false
          if (!progress.completed) {
            progress.completed = true
            progress.updatedAt = new Date().toISOString()
            changed = true
          }
          if (unit.status !== 'completed') {
            unit.status = 'completed'
            unit.completedAt = unit.completedAt || existingReport.createdAt
            changed = true
          }
          if (changed) await writeDb(db)
          res.json({ report: existingReport, duplicate: true })
          return
        }

        const answers = req.body.answers || {}
        const questions = unit.content.questions || []
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
        const viewedWords = Array.isArray(req.body.viewedWords) ? req.body.viewedWords : []
        const vocabularyResult = saveUnitVocabularyFromCompletion(db, req.user.id, book, unit, wrongQuestions, viewedWords)

        const currentSettings = userSettings(db, req.user.id)
        const report = {
          id: nanoid(),
          userId: req.user.id,
          bookId: book.id,
          unitId: unit.id,
          bookTitle: book.title,
          unitTitle: unit.title,
          correctCount,
          questionCount: questions.length,
          correctRate,
          newVocabularyCount: vocabularyResult.newVocabularyCount,
          savedVocabularyCount: vocabularyResult.savedVocabularyCount,
          wrongQuestions,
          readingLevel: currentSettings.readingLevel,
          listeningLevel: currentSettings.listeningLevel,
          studyMinutes: Math.max(1, Math.round(Number(currentSettings.studyMinutes || 10))),
          suggestion: adaptiveSuggestion({ correctRate, newVocabularyCount: vocabularyResult.newVocabularyCount }, currentSettings),
          createdAt: new Date().toISOString(),
        }
        unit.status = 'completed'
        unit.completedAt = new Date().toISOString()
        const progress = ensureUnitProgress(db, req.user.id, unit.id)
        progress.answers = answers
        progress.completed = true
        progress.listeningCompleted = Boolean(req.body.listeningCompleted || progress.listeningCompleted)
        progress.paragraphIndex = Math.max(progress.paragraphIndex || 0, (unit.content.reading?.paragraphs?.length || 1) - 1)
        progress.updatedAt = new Date().toISOString()
        db.reports.push(report)
        report.levelAdjustment = applyAdaptiveLeveling(db, req.user.id)
        await writeDb(db)
        res.json({ report, duplicate: false })
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/units/:unitId/audio', auth, async (req, res, next) => {
    try {
      const db = req.db
      const unit = db.units.find((item) => item.id === req.params.unitId)
      const book = unit ? db.books.find((item) => item.id === unit.bookId && item.userId === req.user.id) : null
      if (!unit || !book || !unit.content) {
        res.status(404).json({ error: '未找到可生成音频的学习单元' })
        return
      }

      const audioRequest = buildSpeechAudioRequest(unit)
      const cachedAudio = await hasCachedSpeechAudio(audioRequest)
      if (!cachedAudio && shouldRateLimitSpeech() && !consumeUserQuota(req, res, 'speech-audio')) return
      let audio
      try {
        audio = await generateSpeechAudio(unit, audioRequest)
      } catch (error) {
        if (!cachedAudio) {
          recordAiUsage(db, {
            userId: req.user.id,
            category: 'audio',
            action: 'speech-audio',
            provider: audioRequest.ttsProvider,
            model: audioRequest.model,
            inputTokens: estimateTextTokens(audioRequest.input),
            success: false,
            statusCode: parseStatusCode(error.message),
            message: error.message || '听力音频生成失败',
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
          action: 'speech-audio',
          provider: audio.ttsProvider,
          model: audio.model,
          inputTokens: estimateTextTokens(audio.input),
          audioBytes: stat?.size || 0,
          success: true,
        })
      }
      unit.audio = {
        model: audio.model,
        voice: audio.voice,
        hash: audio.hash,
        format: audio.outputFormat,
        generatedAt: unit.audio?.hash === audio.hash ? unit.audio.generatedAt : new Date().toISOString(),
      }
      await writeDb(db)

      res.setHeader('Content-Type', audio.contentType)
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(audio.audioPath)
    } catch (error) {
      next(error)
    }
  })
}
