import type { View } from '../navigation'

export type PodcastKind = 'preview' | 'review' | 'topic' | 'walkthrough'

export type UserProfile = {
  id: string
  email: string
  name: string
  role?: string
  createdAt: string
}

export type MicroPracticeType = 'reading' | 'listening' | 'random'
export type MicroPracticeTopic = 'book' | 'weak-vocabulary' | 'history' | 'politics' | 'economics' | 'technology' | 'random' | 'custom'

export type UserSettings = {
  userId: string
  readingLevel: string
  listeningLevel: string
  studyMinutes: number
  chineseAssist: string
  aiSuggestions: boolean
  focusStudyMode?: boolean
  keepSourceFiles: boolean
  podcastLexile: number
  podcastVoice: string
  microPracticeType: MicroPracticeType
  microPracticeTopic: MicroPracticeTopic
  microPracticeDifficulty: string
  microPracticeDailyGoal: number
  microPracticeMonthlyGoal: number
  microPracticeCustomTopic?: string
  lastLevelAdjustedAt?: string
  lastLevelCheckReportId?: string
}

export type Book = {
  id: string
  title: string
  author: string
  type: 'epub' | 'pdf'
  filename: string
  chapterCount: number
  wordCount: number
  totalUnits: number
  generatedUnits: number
  completedUnits: number
  status?: 'ready' | 'processing' | 'failed'
  error?: string
  processingJobId?: string
  createdAt: string
  glossary?: BookGlossary
}

export type BookGlossary = {
  bookId: string
  itemCount: number
  generatedUnitCount: number
  sourceUnitCount: number
  items: BookGlossaryItem[]
}

export type BookGlossaryItem = {
  id: string
  term: string
  category: 'concept' | 'person' | 'place' | 'institution' | 'term'
  categoryLabel: string
  meaningZh?: string
  simpleEnglish?: string
  occurrenceCount: number
  unitCount: number
  sources: Array<{
    unitId: string
    unitTitle: string
    sourceLocation: string
  }>
}

export type Concept = {
  term: string
  simpleEnglish: string
  chinese: string
}

export type VocabularyItem = {
  id?: string
  term: string
  meaningZh: string
  simpleEnglish: string
  exampleSentence?: string
  sourceBookTitle?: string
  seenCount?: number
  mastery?: number
  dueAt?: string
  reviewCount?: number
  lastSeenAt?: string
}

export type Question = {
  id: string
  prompt: string
  options: string[]
  answerIndex: number
  explanationZh: string
  relatedTerms?: string[]
}

export type MicroPractice = {
  id: string
  type: 'reading' | 'listening'
  typeLabel: string
  topic: MicroPracticeTopic
  topicLabel: string
  difficulty: string
  sourceMode: 'book' | 'vocabulary' | 'general' | 'custom' | string
  sourceBookId?: string
  sourceBookTitle?: string
  sourceSummary: string
  keyTerms: string[]
  content: {
    title: string
    body: string
    transcriptHiddenByDefault: boolean
    sourceSummary: string
    concepts: Concept[]
    vocabulary: VocabularyItem[]
    questions: Question[]
  }
  audio?: {
    model?: string
    voice?: string
    format?: string
    generatedAt?: string
  } | null
  status: 'ready' | 'completed'
  generatedBy?: string
  completedAt?: string
  createdAt: string
}

export type MicroAttempt = {
  id: string
  practiceId: string
  type: 'reading' | 'listening'
  topicLabel: string
  difficulty: string
  correctCount: number
  questionCount: number
  correctRate: number
  studyMinutes: number
  savedVocabularyCount: number
  wrongQuestions?: Array<{
    id: string
    prompt: string
    explanationZh: string
    relatedTerms?: string[]
  }>
  suggestion?: string
  createdAt: string
}

export type ReadingParagraph = {
  text: string
  summaryZh: string
}

export type UnitContent = {
  title: string
  level: {
    reading: string
    listening: string
  }
  sourceLocation: string
  background: string
  concepts: Concept[]
  listening: {
    text: string
    transcriptHiddenByDefault: boolean
  }
  reading: {
    paragraphs: ReadingParagraph[]
  }
  vocabulary: VocabularyItem[]
  questions: Question[]
  generationMode: string
  fidelityNote: string
}

export type Unit = {
  id: string
  bookId: string
  title: string
  status: 'planned' | 'generated' | 'completed'
  sourceLocation: string
  sourceText?: string
  sourceExcerpt: string
  sourceWordCount: number
  content: UnitContent | null
  quality?: {
    readingWords: number
    listeningWords: number
    paragraphCount: number
    questionCount: number
    status: 'good' | 'review'
    warnings: string[]
    sourceRefs?: Array<{
      id: string
      label: string
      excerpt: string
      wordCount: number
    }>
    sourceMap?: Array<{
      readingParagraph: number
      status?: 'ok' | 'review'
      confidence?: number
      generatedExcerpt?: string
      coverageNote?: string
      suspiciousSentences?: Array<{
        sentence: string
        reason: string
        sourceParagraphs?: string[]
        confidence?: number
      }>
      sourceRefs: Array<{
        id: string
        label: string
        sourceParagraphIndex?: number
        excerpt: string
        wordCount: number
        keywordOverlap?: number
        matchedKeywords?: string[]
      }>
      note?: string
    }>
    fidelity?: {
      keywordCoverage: number
      coveredKeywords: string[]
      missingKeywords: string[]
      sourceLocation: string
      audit?: {
        mode: string
        score: number
        verdict: string
        risks: string[]
        unsupportedClaims: string[]
        suspiciousSentences?: Array<{
          readingParagraph: number
          sentence: string
          reason: string
          sourceParagraphs: string[]
        }>
        missingImportantIdeas: string[]
        error?: string
      }
    }
  }
  audio?: {
    voice: string
    format: string
  } | null
  generation?: {
    jobId?: string
    status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
    progress?: number
    message?: string
    error?: string
    requestedAt?: string
    finishedAt?: string
    readingLevel?: string
    listeningLevel?: string
  }
  progress?: UnitProgress | null
  versions?: Array<{
    id: string
    title: string
    reason: string
    savedAt: string
    generatedAt: string
    level?: {
      reading: string
      listening: string
    } | null
    quality?: Unit['quality'] | null
    diff?: UnitVersionDiff | null
  }>
  createdAt: string
  generatedAt: string | null
}

export type UnitVersionDiff = {
  previous: VersionMetrics
  current: VersionMetrics
  summary: {
    titleChanged: boolean
    levelChanged: boolean
    changedParagraphs: number
    wordDelta: number
    listeningWordDelta: number
    questionDelta: number
    fidelityScoreDelta: number | null
  }
  paragraphDiffs: Array<{
    paragraph: number
    changed: boolean
    similarity: number
    wordDelta: number
    previousPreview: string
    currentPreview: string
  }>
}

export type VersionMetrics = {
  title: string
  readingLevel: string
  listeningLevel: string
  readingWords: number
  listeningWords: number
  paragraphCount: number
  questionCount: number
}

export type UnitProgress = {
  paragraphIndex: number
  listeningCompleted: boolean
  answers: Record<string, number>
  completed: boolean
  updatedAt?: string
}

export type GenerationJob = {
  id: string
  type: string
  status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
  unitId?: string
  podcastId?: string
  bookId: string
  processedPages?: number
  totalPages?: number
  progress: number
  message: string
  error: string
  errorStage?: string
  errorCode?: string
  errorHint?: string
  retryable?: boolean
  provider?: string
  statusCode?: number | null
  retryCount?: number
  qualityStatus?: string
  autoRetryAt?: string
  autoRetryDelaySeconds?: number
  autoRetryReason?: string
  lastError?: string
  lastErrorCode?: string
  lastErrorStage?: string
  canRetryNow?: boolean
  nextActionKind?: string
  nextActionLabel?: string
  nextActionDetail?: string
  usageSummary?: {
    label: string
    detail: string
    estimated?: boolean
  } | null
  unitTitle?: string
  podcastTitle?: string
  bookTitle?: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type Podcast = {
  id: string
  bookId: string
  kind?: PodcastKind
  kindLabel?: string
  index: number
  title: string
  status: 'planned' | 'scripting' | 'synthesizing' | 'ready' | 'failed'
  sourceUnitIds: string[]
  sourceWordCount: number
  lexile: number
  voice?: string
  scriptText?: string | null
  scriptMode?: string
  audio?: {
    file: string
    format: string
    contentType?: string
    byteLength?: number
    voice: string
    provider?: string
    model?: string
    promptProfile?: string
    durationSeconds: number
    chunkCount: number
    generatedAt: string
  } | null
  progress?: {
    positionSeconds: number
    completed: boolean
    updatedAt?: string
  }
  jobId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type Report = {
  id: string
  bookId: string
  unitId: string
  bookTitle: string
  unitTitle: string
  correctCount: number
  questionCount: number
  correctRate: number
  newVocabularyCount: number
  suggestion: {
    reading: string
    listening: string
    action: string
  }
  readingLevel?: string
  listeningLevel?: string
  studyMinutes?: number
  levelAdjustment?: {
    applied: boolean
    readingLevel: string
    listeningLevel: string
    message: string
    from?: {
      readingLevel: string
      listeningLevel: string
    }
    to?: {
      readingLevel: string
      listeningLevel: string
    }
  }
  createdAt: string
}

export type AppData = {
  user: UserProfile
  settings: UserSettings
  home: {
    continueBook: Book | null
    continueUnit: Unit | null
    recentBooks: Book[]
    latestReport: Report | null
    activeJobs: GenerationJob[]
    failedJobs: GenerationJob[]
  }
  books: Book[]
  vocabulary: VocabularyItem[]
  reports: Report[]
  micro: {
    recentPractices: MicroPractice[]
    recentAttempts: MicroAttempt[]
  }
  stats: {
    completedUnits: number
    microPracticeCount: number
    microMonthPractices: number
    averageCorrectRate: number
    microCorrectRate: number
    vocabularyCount: number
    dueVocabulary: number
    masteredVocabulary: number
    readingMinutes: number
    microPracticeMinutes: number
    studyMinutesTotal: number
    todayReadingMinutes: number
    todayStudyMinutes: number
    weeklyReadingMinutes: number
    weeklyStudyMinutes: number
    recentReports: Array<{
      date: string
      correctRate: number
      words: number
    }>
    todayCompleted: number
    todayMicroPractices: number
    dailyGoalUnits: number
    dailyGoalMinutes: number
    microDailyGoal: number
    microMonthlyGoal: number
    microTodayGoalMet: boolean
    microMonthGoalMet: boolean
    todayGoalMet: boolean
    streakDays: number
    calendar: Array<{
      date: string
      units: number
      microPractices: number
      words: number
      correctRate: number
      minutes: number
    }>
    activity: Array<{
      date: string
      units: number
      microPractices: number
      words: number
      correctRate: number
      minutes: number
    }>
    recentMicroPractices: MicroAttempt[]
    vocabularyGrowth: {
      total: number
      addedThisWeek: number
      addedThisMonth: number
      averagePerUnit: number
      daily: Array<{
        date: string
        added: number
        total: number
      }>
    }
    reviewPlan: {
      dueToday: number
      dueTomorrow: number
      dueThisWeek: number
      mastered: number
      learning: number
      weak: number
      message: string
    }
    recommendation: {
      title: string
      body: string
      actionLabel: string
      view: View
    }
    difficultyTrend: Array<{
      date: string
      unitTitle: string
      readingLevel: string
      listeningLevel: string
      correctRate: number
      newVocabularyCount: number
    }>
    difficultySummary: {
      readingLevel: string
      listeningLevel: string
      readingDelta: number
      listeningDelta: number
      message: string
    }
  }
}
