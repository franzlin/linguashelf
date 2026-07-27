// Home screen, dashboard metrics, difficulty trends and vocabulary export.
//
// Adaptive difficulty is deliberately conservative: it moves one step at a time
// and only after a run of consistent results, because thrashing the level is
// worse for a learner than being slightly off.
import { normalizeText } from './text.js'
import { levelIndex, listeningLevels, normalizeLevel, readingLevels, shiftLevel } from './levels.js'
import { userSettings } from './settings.js'
import { microPracticeSuggestion, publicMicroPractice } from './micro.js'
import { adaptiveSuggestion } from './quality.js'
import { publicUnit } from './progress.js'
import { publicJob, publicJobWithContext } from './jobs.js'
import { sortPodcasts } from './podcast.js'

export function summarizeBook(book, units) {
  const { userId, sourcePath, sourceTemporary, ...safeBook } = book
  const total = units.length
  const generated = units.filter((unit) => unit.status !== 'planned').length
  const completed = units.filter((unit) => unit.status === 'completed').length
  return { ...safeBook, sourceRetained: Boolean(sourcePath), totalUnits: total, generatedUnits: generated, completedUnits: completed }
}

export function computeHome(db, userId) {
  const userBooks = db.books
    .filter((book) => book.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const userBookIds = new Set(userBooks.map((book) => book.id))
  const userUnits = db.units.filter((unit) => userBookIds.has(unit.bookId))
  const reports = db.reports.filter((report) => report.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const completedIds = new Set(reports.map((report) => report.unitId))
  const inProgress = db.progress
    .filter((item) => item.userId === userId && !item.completed)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((item) => userUnits.find((unit) => unit.id === item.unitId))
    .find(Boolean)
  const latestReport = reports[0]
  const latestUnit = latestReport ? userUnits.find((unit) => unit.id === latestReport.unitId) : null
  const latestBookUnits = latestUnit ? userUnits.filter((unit) => unit.bookId === latestUnit.bookId) : []
  const latestIndex = latestUnit ? latestBookUnits.findIndex((unit) => unit.id === latestUnit.id) : -1
  let continueUnit = inProgress || (latestIndex >= 0 ? latestBookUnits.slice(latestIndex + 1).find((unit) => unit.status !== 'completed') : null)

  if (!continueUnit) continueUnit = userUnits.find((unit) => unit.status === 'generated' && !completedIds.has(unit.id))
  if (!continueUnit) continueUnit = userUnits.find((unit) => unit.status === 'planned')

  const continueBook = continueUnit ? userBooks.find((book) => book.id === continueUnit.bookId) : null
  const activeJobs = db.jobs
    .filter((job) => job.userId === userId && ['queued', 'running'].includes(job.status))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, 8)
  const failedJobs = db.jobs
    .filter((job) => job.userId === userId && job.status === 'failed')
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, 3)

  return {
    continueBook: continueBook ? summarizeBook(continueBook, userUnits.filter((unit) => unit.bookId === continueBook.id)) : null,
    continueUnit: publicUnit(continueUnit, db, userId),
    recentBooks: userBooks.slice(0, 3).map((book) => summarizeBook(book, userUnits.filter((unit) => unit.bookId === book.id))),
    latestReport: latestReport || null,
    activeJobs: activeJobs.map(publicJob),
    failedJobs: failedJobs.map((job) => publicJobWithContext(job, db)),
  }
}

export function computeStats(db, userId) {
  const reports = db.reports
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const microAttempts = (db.microAttempts || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const vocabulary = db.vocabulary.filter((item) => item.userId === userId)
  const settings = userSettings(db, userId)
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  const completedUnits = reports.length
  const microPracticeCount = microAttempts.length
  const microMonthPractices = microAttempts.filter((attempt) => String(attempt.createdAt || '').slice(0, 7) === currentMonth).length
  const averageCorrectRate = reports.length
    ? reports.reduce((total, report) => total + Number(report.correctRate || 0), 0) / reports.length
    : 0
  const microCorrectRate = microAttempts.length
    ? microAttempts.reduce((total, attempt) => total + Number(attempt.correctRate || 0), 0) / microAttempts.length
    : 0
  const dueVocabulary = vocabulary.filter((item) => !item.dueAt || Date.parse(item.dueAt) <= now).length
  const masteredVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) >= 4).length
  const readingMinutes = reports.reduce((total, report) => total + reportStudyMinutes(report, settings), 0)
  const microPracticeMinutes = microAttempts.reduce((total, attempt) => total + Math.max(1, Math.round(Number(attempt.studyMinutes || 2))), 0)
  const studyMinutesTotal = readingMinutes + microPracticeMinutes
  const recentReports = reports
    .filter((report) => Date.parse(report.createdAt) >= now - 14 * 24 * 60 * 60 * 1000)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((report) => ({
      date: report.createdAt.slice(0, 10),
      correctRate: report.correctRate,
      words: report.newVocabularyCount,
    }))
  const dailyMap = new Map()
  for (const report of reports) {
    const date = String(report.createdAt || '').slice(0, 10)
    if (!date) continue
    const item = dailyMap.get(date) || { date, units: 0, microPractices: 0, words: 0, correctRate: 0, scoreCount: 0, minutes: 0 }
    item.units += 1
    item.words += Number(report.newVocabularyCount || 0)
    item.correctRate += Number(report.correctRate || 0)
    item.scoreCount += 1
    item.minutes += reportStudyMinutes(report, settings)
    dailyMap.set(date, item)
  }
  for (const attempt of microAttempts) {
    const date = String(attempt.createdAt || '').slice(0, 10)
    if (!date) continue
    const item = dailyMap.get(date) || { date, units: 0, microPractices: 0, words: 0, correctRate: 0, scoreCount: 0, minutes: 0 }
    item.microPractices += 1
    item.words += Number(attempt.savedVocabularyCount || 0)
    item.correctRate += Number(attempt.correctRate || 0)
    item.scoreCount += 1
    item.minutes += Math.max(1, Math.round(Number(attempt.studyMinutes || 2)))
    dailyMap.set(date, item)
  }
  const calendar = buildDailySeries(dailyMap, now, 14)
  const activity = buildDailySeries(dailyMap, now, 30)
  const vocabularyGrowth = computeVocabularyGrowth(vocabulary, reports, now)
  const difficultyTrend = buildDifficultyTrend(reports, settings)
  const lastDifficulty = difficultyTrend[difficultyTrend.length - 1]
  const previousDifficulty = difficultyTrend.length > 1 ? difficultyTrend[difficultyTrend.length - 2] : null
  const readingDelta = previousDifficulty ? levelIndex(readingLevels, lastDifficulty.readingLevel) - levelIndex(readingLevels, previousDifficulty.readingLevel) : 0
  const listeningDelta = previousDifficulty
    ? levelIndex(listeningLevels, lastDifficulty.listeningLevel) - levelIndex(listeningLevels, previousDifficulty.listeningLevel)
    : 0
  const weeklyStudyMinutes = activity.slice(-7).reduce((total, item) => total + Number(item.minutes || 0), 0)
  const weeklyReadingMinutes = reports
    .filter((report) => Date.parse(report.createdAt || '') >= now - 7 * 24 * 60 * 60 * 1000)
    .reduce((total, report) => total + reportStudyMinutes(report, settings), 0)
  const todayCompleted = dailyMap.get(today)?.units || 0
  const todayMicroPractices = dailyMap.get(today)?.microPractices || 0
  const todayStudyMinutes = dailyMap.get(today)?.minutes || 0
  const todayReadingMinutes = reports
    .filter((report) => String(report.createdAt || '').slice(0, 10) === today)
    .reduce((total, report) => total + reportStudyMinutes(report, settings), 0)
  const dailyGoalMinutes = Math.max(1, Math.round(Number(settings.studyMinutes || 10)))
  const dailyGoalUnits = Math.max(1, Math.round(dailyGoalMinutes / 10))
  const microDailyGoal = Math.max(0, Math.round(Number(settings.microPracticeDailyGoal ?? 1)))
  const microMonthlyGoal = Math.max(0, Math.round(Number(settings.microPracticeMonthlyGoal ?? 30)))
  const microTodayGoalMet = microDailyGoal > 0 && todayMicroPractices >= microDailyGoal
  const microMonthGoalMet = microMonthlyGoal > 0 && microMonthPractices >= microMonthlyGoal
  const todayGoalMet = todayStudyMinutes >= dailyGoalMinutes || todayCompleted >= dailyGoalUnits || microTodayGoalMet
  const dueTomorrow = vocabulary.filter((item) => {
    const due = Date.parse(item.dueAt || '')
    return Number.isFinite(due) && due > now && due <= now + 24 * 60 * 60 * 1000
  }).length
  const dueThisWeek = vocabulary.filter((item) => {
    const due = Date.parse(item.dueAt || '')
    return !item.dueAt || (Number.isFinite(due) && due <= now + 7 * 24 * 60 * 60 * 1000)
  }).length
  const weakVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) <= 1).length
  const learningVocabulary = vocabulary.filter((item) => Number(item.mastery || 0) < 4).length
  const reviewPlan = {
    dueToday: dueVocabulary,
    dueTomorrow,
    dueThisWeek,
    mastered: masteredVocabulary,
    learning: learningVocabulary,
    weak: weakVocabulary,
    message: dueVocabulary
      ? `今天有 ${dueVocabulary} 个生词到期，先复习会让阅读更轻。`
      : dueTomorrow
        ? `明天有 ${dueTomorrow} 个生词到期，今天可以继续阅读。`
        : '当前没有到期生词，可以把时间留给阅读。'
  }
  const recommendation = dueVocabulary
    ? {
        title: '先复习到期生词',
        body: `有 ${dueVocabulary} 个词已经到复习时间，处理完再读新材料会更稳。`,
        actionLabel: '去生词本',
        view: 'vocabulary',
      }
    : todayGoalMet
      ? {
          title: '今天目标已完成',
          body: '可以轻量听一集播客，或者留到明天继续。',
          actionLabel: '查看数据',
          view: 'dashboard',
        }
      : {
          title: '继续下一篇阅读',
          body: `今日目标 ${dailyGoalMinutes} 分钟，目前约 ${todayReadingMinutes} 分钟。`,
          actionLabel: '回到首页',
          view: 'home',
        }

  let streakDays = 0
  for (let index = 0; index < 365; index += 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const day = dailyMap.get(date)
    if ((day?.units || 0) + (day?.microPractices || 0) === 0) break
    streakDays += 1
  }
  const recentMicroPractices = microAttempts
    .slice(-12)
    .reverse()
    .map((attempt) => ({
      id: attempt.id,
      practiceId: attempt.practiceId,
      type: attempt.type,
      topicLabel: attempt.topicLabel || attempt.topic || '每日轻练',
      difficulty: attempt.difficulty,
      correctCount: Number(attempt.correctCount || 0),
      questionCount: Number(attempt.questionCount || 0),
      correctRate: Number(attempt.correctRate || 0),
      studyMinutes: Number(attempt.studyMinutes || 0),
      savedVocabularyCount: Number(attempt.savedVocabularyCount || 0),
      createdAt: attempt.createdAt,
    }))

  return {
    completedUnits,
    microPracticeCount,
    microMonthPractices,
    averageCorrectRate,
    microCorrectRate,
    vocabularyCount: vocabulary.length,
    dueVocabulary,
    masteredVocabulary,
    recentReports,
    todayCompleted,
    todayMicroPractices,
    dailyGoalUnits,
    dailyGoalMinutes,
    microDailyGoal,
    microMonthlyGoal,
    microTodayGoalMet,
    microMonthGoalMet,
    todayGoalMet,
    streakDays,
    calendar,
    readingMinutes,
    microPracticeMinutes,
    studyMinutesTotal,
    todayReadingMinutes,
    todayStudyMinutes,
    weeklyReadingMinutes,
    weeklyStudyMinutes,
    activity,
    recentMicroPractices,
    vocabularyGrowth,
    reviewPlan,
    recommendation,
    difficultyTrend,
    difficultySummary: {
      readingLevel: lastDifficulty?.readingLevel || settings.readingLevel,
      listeningLevel: lastDifficulty?.listeningLevel || settings.listeningLevel,
      readingDelta,
      listeningDelta,
      message: difficultyTrend.length
        ? difficultySummaryMessage(readingDelta, listeningDelta)
        : '完成单元后会开始记录难度变化。',
    },
  }
}

export function reportStudyMinutes(report, settings) {
  return Math.max(1, Math.round(Number(report.studyMinutes || settings.studyMinutes || 10)))
}

export function buildDailySeries(dailyMap, now, days) {
  const items = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const item = dailyMap.get(date) || { date, units: 0, microPractices: 0, words: 0, correctRate: 0, scoreCount: 0, minutes: 0 }
    items.push({
      ...item,
      microPractices: Number(item.microPractices || 0),
      correctRate: item.scoreCount ? item.correctRate / item.scoreCount : 0,
    })
  }
  return items
}

export function computeVocabularyGrowth(vocabulary, reports, now) {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000
  const windowStart = now - 29 * 24 * 60 * 60 * 1000
  const dailyAdds = new Map()
  for (const item of vocabulary) {
    const createdAt = Date.parse(item.createdAt || item.lastSeenAt || '')
    if (!createdAt) continue
    const date = new Date(createdAt).toISOString().slice(0, 10)
    dailyAdds.set(date, (dailyAdds.get(date) || 0) + 1)
  }
  let runningTotal = vocabulary.filter((item) => {
    const createdAt = Date.parse(item.createdAt || item.lastSeenAt || '')
    return createdAt && createdAt < windowStart
  }).length
  const daily = []
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date(now - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const added = dailyAdds.get(date) || 0
    runningTotal += added
    daily.push({ date, added, total: runningTotal })
  }
  const addedThisWeek = vocabulary.filter((item) => Date.parse(item.createdAt || item.lastSeenAt || '') >= weekAgo).length
  const addedThisMonth = vocabulary.filter((item) => Date.parse(item.createdAt || item.lastSeenAt || '') >= monthAgo).length
  return {
    total: vocabulary.length,
    addedThisWeek,
    addedThisMonth,
    averagePerUnit: reports.length ? vocabulary.length / reports.length : 0,
    daily,
  }
}

export function buildDifficultyTrend(reports, settings) {
  return reports.slice(-16).map((report) => {
    const readingLevel =
      report.readingLevel ||
      report.levelAdjustment?.from?.readingLevel ||
      report.levelAdjustment?.readingLevel ||
      settings.readingLevel
    const listeningLevel =
      report.listeningLevel ||
      report.levelAdjustment?.from?.listeningLevel ||
      report.levelAdjustment?.listeningLevel ||
      settings.listeningLevel
    return {
      date: String(report.createdAt || '').slice(0, 10),
      unitTitle: report.unitTitle,
      readingLevel: normalizeLevel(readingLevels, readingLevel, settings.readingLevel),
      listeningLevel: normalizeLevel(listeningLevels, listeningLevel, settings.listeningLevel),
      correctRate: Number(report.correctRate || 0),
      newVocabularyCount: Number(report.newVocabularyCount || 0),
    }
  })
}

export function difficultySummaryMessage(readingDelta, listeningDelta) {
  if (readingDelta > 0 || listeningDelta > 0) return '最近难度有上调，继续观察正确率和生词负担。'
  if (readingDelta < 0 || listeningDelta < 0) return '最近难度有下调，先把理解稳定下来。'
  return '最近难度保持稳定。'
}

export function csvCell(value) {
  return `"${escapeSpreadsheetFormula(value).replace(/"/g, '""')}"`
}

export function tsvCell(value) {
  return escapeSpreadsheetFormula(value)
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
}

export function escapeSpreadsheetFormula(value) {
  const text = String(value || '')
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
}

export function applyAdaptiveLeveling(db, userId) {
  const settings = userSettings(db, userId)
  if (!settings.aiSuggestions) {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: '自动难度调整已关闭。',
    }
  }

  const since = settings.lastLevelAdjustedAt || ''
  const reports = db.reports
    .filter((report) => report.userId === userId && (!since || String(report.createdAt) > since))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))

  if (reports.length < 3) {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: `再完成 ${3 - reports.length} 个单元后判断难度。`,
    }
  }

  const recent = reports.slice(-3)
  const averageCorrectRate = recent.reduce((total, report) => total + Number(report.correctRate || 0), 0) / recent.length
  const averageWords = recent.reduce((total, report) => total + Number(report.newVocabularyCount || 0), 0) / recent.length
  let readingStep = 0
  let listeningStep = 0
  let reason = ''

  if (averageCorrectRate >= 0.88 && averageWords <= 8) {
    readingStep = 1
    if (averageCorrectRate >= 0.92 && averageWords <= 6) listeningStep = 1
    reason = '最近 3 个单元正确率高、生词少'
  } else if (averageCorrectRate < 0.55 || averageWords >= 18) {
    readingStep = -1
    if (averageCorrectRate < 0.5) listeningStep = -1
    reason = '最近 3 个单元负担偏高'
  } else {
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: '最近 3 个单元难度合适，保持当前设置。',
    }
  }

  const previous = {
    readingLevel: settings.readingLevel,
    listeningLevel: settings.listeningLevel,
  }
  const nextReading = shiftLevel(readingLevels, settings.readingLevel, readingStep)
  const nextListening = shiftLevel(listeningLevels, settings.listeningLevel, listeningStep)

  if (nextReading === settings.readingLevel && nextListening === settings.listeningLevel) {
    settings.lastLevelAdjustedAt = new Date().toISOString()
    return {
      applied: false,
      readingLevel: settings.readingLevel,
      listeningLevel: settings.listeningLevel,
      message: `${reason}，但当前设置已到可调整边界。`,
    }
  }

  settings.readingLevel = nextReading
  settings.listeningLevel = nextListening
  settings.lastLevelAdjustedAt = new Date().toISOString()
  settings.lastLevelCheckReportId = recent[recent.length - 1]?.id

  return {
    applied: true,
    from: previous,
    to: {
      readingLevel: nextReading,
      listeningLevel: nextListening,
    },
    readingLevel: nextReading,
    listeningLevel: nextListening,
    message: `${reason}，已调整为阅读 ${nextReading}、听力 ${nextListening}。`,
  }
}
