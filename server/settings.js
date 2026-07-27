// Per-user study settings and the validators the settings record depends on.
//
// The micro-practice normalizers live here rather than in micro.js so that
// module can depend on settings without the two importing each other.
import { legacyPodcastVoices, podcastLexileDefault, podcastLexileMax, podcastLexileMin } from './config.js'
import { normalizeText } from './text.js'
import { listeningLevels, normalizeLevel, readingLevels } from './levels.js'
import { defaultPodcastVoice, normalizePodcastVoice } from './tts.js'

export function userSettings(db, userId) {
  let settings = db.settings.find((item) => item.userId === userId)
  if (!settings) {
    settings = {
      userId,
      readingLevel: 'A2+',
      listeningLevel: 'A2',
      studyMinutes: 10,
      chineseAssist: 'click',
      aiSuggestions: true,
      focusStudyMode: true,
      keepSourceFiles: true,
      podcastLexile: podcastLexileDefault,
      podcastVoice: defaultPodcastVoice(),
      microPracticeType: 'random',
      microPracticeTopic: 'book',
      microPracticeDifficulty: 'A2+',
      microPracticeDailyGoal: 1,
      microPracticeMonthlyGoal: 30,
      microPracticeCustomTopic: '',
    }
    db.settings.push(settings)
  }
  if (settings.focusStudyMode === undefined) settings.focusStudyMode = true
  if (!settings.podcastLexile) settings.podcastLexile = podcastLexileDefault
  if (!settings.podcastVoice || legacyPodcastVoices.has(settings.podcastVoice)) settings.podcastVoice = defaultPodcastVoice()
  settings.podcastVoice = normalizePodcastVoice(settings.podcastVoice)
  if (!settings.microPracticeType) settings.microPracticeType = 'random'
  if (!settings.microPracticeTopic) settings.microPracticeTopic = 'book'
  if (!settings.microPracticeDifficulty) settings.microPracticeDifficulty = settings.readingLevel || 'A2+'
  if (settings.microPracticeDailyGoal === undefined) settings.microPracticeDailyGoal = 1
  if (settings.microPracticeMonthlyGoal === undefined) settings.microPracticeMonthlyGoal = 30
  if (settings.microPracticeCustomTopic === undefined) settings.microPracticeCustomTopic = ''
  settings.readingLevel = normalizeLevel(readingLevels, settings.readingLevel, 'A2+')
  settings.listeningLevel = normalizeLevel(listeningLevels, settings.listeningLevel, 'A2')
  settings.podcastLexile = Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault)))
  settings.microPracticeType = normalizeMicroPracticeType(settings.microPracticeType, 'random')
  settings.microPracticeTopic = normalizeMicroPracticeTopic(settings.microPracticeTopic, 'book')
  settings.microPracticeDifficulty = normalizeLevel([...listeningLevels, ...readingLevels], settings.microPracticeDifficulty, settings.readingLevel)
  settings.microPracticeDailyGoal = Math.max(0, Math.min(10, Math.round(Number(settings.microPracticeDailyGoal ?? 1))))
  settings.microPracticeMonthlyGoal = Math.max(0, Math.min(300, Math.round(Number(settings.microPracticeMonthlyGoal ?? 30))))
  settings.microPracticeCustomTopic = normalizeText(settings.microPracticeCustomTopic).slice(0, 80)
  return settings
}

export function normalizeMicroPracticeType(value, fallback = 'random') {
  const type = String(value || '').trim().toLowerCase()
  if (['reading', 'text', 'short-reading', '阅读'].includes(type)) return 'reading'
  if (['listening', 'audio', '听力'].includes(type)) return 'listening'
  if (['random', '随机'].includes(type)) return 'random'
  return fallback
}

export function normalizeMicroPracticeTopic(value, fallback = 'book') {
  const topic = String(value || '').trim().toLowerCase()
  if (['book', 'recent-book', 'current-book', '书籍主题', '最近书籍'].includes(topic)) return 'book'
  if (['weak-vocabulary', 'vocabulary', 'words', '近期生词', '薄弱生词', '生词'].includes(topic)) return 'weak-vocabulary'
  if (['history', '历史'].includes(topic)) return 'history'
  if (['politics', 'political', '政治'].includes(topic)) return 'politics'
  if (['economics', 'economy', 'economic', '经济'].includes(topic)) return 'economics'
  if (['technology', 'tech', '科技'].includes(topic)) return 'technology'
  if (['random', '随机'].includes(topic)) return 'random'
  if (['custom', '自定义'].includes(topic)) return 'custom'
  return fallback
}
