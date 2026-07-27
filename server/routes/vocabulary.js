import { nanoid } from 'nanoid'
import {
  definitionCacheKey,
  fallbackChineseMeaning,
  fallbackDefinition,
  generateWordDefinition,
} from './../content.js'
import { parseStatusCode } from './../job-diagnosis.js'
import { shouldRateLimitAiText } from './../quota.js'
import { consumeUserQuota } from './../ratelimit.js'
import { computeStats, csvCell, tsvCell } from './../stats.js'
import { writeDb } from './../storage.js'
import { recordAiUsage, shouldRecordTextAiUsage, textAiUsageSource } from './../telemetry.js'
import { estimateTextTokens } from './../text.js'
import { auth } from './../users.js'

export function registerVocabularyRoutes(app) {
  app.post('/api/words/define', auth, async (req, res, next) => {
    try {
      const term = String(req.body.term || '').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
      const sentence = String(req.body.sentence || '').trim()
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(term)) {
        res.status(400).json({ error: '请选择一个英文单词' })
        return
      }

      const db = req.db
      const key = definitionCacheKey(term, sentence)
      let definition = db.definitions.find((item) => item.userId === req.user.id && item.key === key)
      if (!definition) {
        if (shouldRateLimitAiText() && !consumeUserQuota(req, res, 'define-word')) return
        let detail
        try {
          detail = await generateWordDefinition(term, sentence)
          if (shouldRecordTextAiUsage()) {
            const source = textAiUsageSource()
            recordAiUsage(db, {
              userId: req.user.id,
              category: 'text',
              action: 'define-word',
              ...source,
              inputTokens: estimateTextTokens(`${term}\n${sentence}`),
              outputTokens: estimateTextTokens(JSON.stringify(detail)),
              success: true,
            })
          }
        } catch (error) {
          if (shouldRecordTextAiUsage()) {
            const source = textAiUsageSource()
            recordAiUsage(db, {
              userId: req.user.id,
              category: 'text',
              action: 'define-word',
              ...source,
              inputTokens: estimateTextTokens(`${term}\n${sentence}`),
              success: false,
              statusCode: parseStatusCode(error.message),
              message: error.message || '单词释义失败，使用本地兜底',
            })
          }
          detail = fallbackDefinition(term)
        }

        definition = {
          id: nanoid(),
          key,
          userId: req.user.id,
          term: detail.term || term,
          meaningZh: detail.meaningZh || fallbackChineseMeaning(term),
          simpleEnglish: detail.simpleEnglish || fallbackDefinition(term).simpleEnglish,
          sentence: sentence.slice(0, 500),
          createdAt: new Date().toISOString(),
        }
        db.definitions.push(definition)
        await writeDb(db)
      }

      res.json({
        definition: {
          term: definition.term,
          meaningZh: definition.meaningZh,
          simpleEnglish: definition.simpleEnglish,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/vocabulary/export', auth, async (req, res) => {
    const db = req.db
    const format = String(req.query.format || 'csv').toLowerCase()
    const vocabulary = db.vocabulary.filter((item) => item.userId === req.user.id)
    if (format === 'anki') {
      const rows = vocabulary.map((item) => [
        item.term,
        item.meaningZh,
        item.simpleEnglish,
        item.exampleSentence || '',
        item.sourceBookTitle || '',
      ])
      const tsv = rows.map((row) => row.map(tsvCell).join('\t')).join('\n')
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="linguashelf-vocabulary.anki.tsv"')
      res.send(`\ufeff${tsv}`)
      return
    }

    const rows = [['term', 'meaning_zh', 'simple_english', 'example_sentence', 'source_book', 'mastery', 'seen_count']]
    for (const item of vocabulary) {
      rows.push([
        item.term,
        item.meaningZh,
        item.simpleEnglish,
        item.exampleSentence || '',
        item.sourceBookTitle || '',
        String(item.mastery || 0),
        String(item.seenCount || 1),
      ])
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="linguashelf-vocabulary.csv"')
    res.send(`\ufeff${csv}`)
  })

  app.patch('/api/vocabulary/:vocabId/review', auth, async (req, res) => {
    const db = req.db
    const item = db.vocabulary.find((entry) => entry.id === req.params.vocabId && entry.userId === req.user.id)
    if (!item) {
      res.status(404).json({ error: '未找到这个生词' })
      return
    }

    const result = req.body.result === 'known' ? 'known' : 'again'
    const currentMastery = Number(item.mastery || 0)
    item.mastery = result === 'known' ? Math.min(5, currentMastery + 1) : Math.max(0, currentMastery - 1)
    item.reviewCount = Number(item.reviewCount || 0) + 1
    item.lastReviewedAt = new Date().toISOString()

    const intervals = [1, 2, 4, 7, 14, 30]
    const days = result === 'known' ? intervals[item.mastery] || 30 : 1
    item.dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    await writeDb(db)
    res.json({ vocabulary: item, stats: computeStats(db, req.user.id) })
  })
}
