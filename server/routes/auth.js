import { nanoid } from 'nanoid'
import {
  podcastLexileDefault,
  podcastLexileMax,
  podcastLexileMin,
  sessionDays,
} from './../config.js'
import { listeningLevels, normalizeLevel, readingLevels } from './../levels.js'
import { publicMicroAttempt, publicMicroPractice } from './../micro.js'
import { clearLoginFailures, loginLimitStatus, recordLoginFailure } from './../ratelimit.js'
import { normalizeMicroPracticeTopic, normalizeMicroPracticeType, userSettings } from './../settings.js'
import { computeHome, computeStats, summarizeBook } from './../stats.js'
import { readDb, writeDb } from './../storage.js'
import { normalizeText } from './../text.js'
import { normalizePodcastVoice } from './../tts.js'
import {
  auth,
  canCreateUser,
  clearSessionCookie,
  hashPassword,
  hashSessionToken,
  passwordHashNeedsUpgrade,
  publicUser,
  setSessionCookie,
  validatePasswordStrength,
  verifyPassword,
} from './../users.js'

export function registerAuthRoutes(app) {
  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const inviteCode = String(req.body.inviteCode || '')
    const loginFailureMessage = '邮箱或密码不正确，或当前不允许创建账号'
    if (!email || !password) {
      res.status(400).json({ error: '请输入邮箱和密码' })
      return
    }

    const limit = loginLimitStatus(req, email)
    if (limit.limited) {
      res.status(429).json({ error: '登录尝试过多，请稍后再试' })
      return
    }

    const db = await readDb()
    let user = db.users.find((item) => item.email === email)
    if (!user) {
      if (!canCreateUser(inviteCode)) {
        recordLoginFailure(limit.key)
        res.status(401).json({ error: loginFailureMessage })
        return
      }
      const passwordError = validatePasswordStrength(password)
      if (passwordError) {
        recordLoginFailure(limit.key)
        res.status(400).json({ error: passwordError })
        return
      }
      user = {
        id: nanoid(),
        email,
        name: email.split('@')[0] || 'Learner',
        passwordHash: await hashPassword(password),
        role: 'user',
        createdAt: new Date().toISOString(),
      }
      db.users.push(user)
      userSettings(db, user.id)
    } else {
      if (!(await verifyPassword(password, user.passwordHash))) {
        recordLoginFailure(limit.key)
        res.status(401).json({ error: loginFailureMessage })
        return
      }
      if (passwordHashNeedsUpgrade(user.passwordHash)) user.passwordHash = await hashPassword(password)
    }

    const token = nanoid(48)
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString()
    db.sessions.push({ tokenHash: hashSessionToken(token), userId: user.id, createdAt, expiresAt })
    await writeDb(db)
    clearLoginFailures(limit.key)
    setSessionCookie(req, res, token, expiresAt)
    res.json({ user: publicUser(user), settings: userSettings(db, user.id) })
  })

  app.get('/api/app', auth, async (req, res) => {
    const db = req.db
    const books = db.books
      .filter((book) => book.userId === req.user.id)
      .map((book) => summarizeBook(book, db.units.filter((unit) => unit.bookId === book.id)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

    res.json({
      user: publicUser(req.user),
      settings: userSettings(db, req.user.id),
      home: computeHome(db, req.user.id),
      books,
      vocabulary: db.vocabulary.filter((item) => item.userId === req.user.id),
      reports: db.reports.filter((item) => item.userId === req.user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      micro: {
        recentPractices: (db.microPractices || [])
          .filter((item) => item.userId === req.user.id)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 8)
          .map(publicMicroPractice),
        recentAttempts: (db.microAttempts || [])
          .filter((item) => item.userId === req.user.id)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 12)
          .map(publicMicroAttempt),
      },
      stats: computeStats(db, req.user.id),
    })
  })

  app.patch('/api/settings', auth, async (req, res) => {
    const db = req.db
    const settings = userSettings(db, req.user.id)
    const allowed = [
      'readingLevel',
      'listeningLevel',
      'studyMinutes',
      'chineseAssist',
      'aiSuggestions',
      'focusStudyMode',
      'keepSourceFiles',
      'podcastLexile',
      'podcastVoice',
      'microPracticeType',
      'microPracticeTopic',
      'microPracticeDifficulty',
      'microPracticeDailyGoal',
      'microPracticeMonthlyGoal',
      'microPracticeCustomTopic',
    ]
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) settings[key] = req.body[key]
    }
    settings.readingLevel = normalizeLevel(readingLevels, settings.readingLevel, 'A2+')
    settings.listeningLevel = normalizeLevel(listeningLevels, settings.listeningLevel, 'A2')
    settings.podcastLexile = Math.max(podcastLexileMin, Math.min(podcastLexileMax, Number(settings.podcastLexile || podcastLexileDefault)))
    settings.podcastVoice = normalizePodcastVoice(settings.podcastVoice)
    settings.microPracticeType = normalizeMicroPracticeType(settings.microPracticeType, 'random')
    settings.microPracticeTopic = normalizeMicroPracticeTopic(settings.microPracticeTopic, 'book')
    settings.microPracticeDifficulty = normalizeLevel([...listeningLevels, ...readingLevels], settings.microPracticeDifficulty, settings.readingLevel)
    settings.microPracticeDailyGoal = Math.max(0, Math.min(10, Math.round(Number(settings.microPracticeDailyGoal ?? 1))))
    settings.microPracticeMonthlyGoal = Math.max(0, Math.min(300, Math.round(Number(settings.microPracticeMonthlyGoal ?? 30))))
    settings.microPracticeCustomTopic = normalizeText(settings.microPracticeCustomTopic).slice(0, 80)
    await writeDb(db)
    res.json({ settings })
  })

  app.patch('/api/account/password', auth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '')
    const nextPassword = String(req.body.nextPassword || '')
    const passwordError = validatePasswordStrength(nextPassword)
    if (passwordError) {
      res.status(400).json({ error: passwordError })
      return
    }
    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      res.status(401).json({ error: '当前密码不正确' })
      return
    }

    const db = req.db
    const user = db.users.find((item) => item.id === req.user.id)
    if (!user) {
      res.status(404).json({ error: '账号不存在' })
      return
    }
    user.passwordHash = await hashPassword(nextPassword)
    user.passwordChangedAt = new Date().toISOString()
    db.sessions = db.sessions.filter((session) => session.tokenHash === req.sessionTokenHash || session.userId !== user.id)
    await writeDb(db)
    res.json({ ok: true })
  })

  app.post('/api/logout', auth, async (req, res) => {
    const db = req.db
    db.sessions = db.sessions.filter((item) => item.tokenHash !== req.sessionTokenHash)
    await writeDb(db)
    clearSessionCookie(req, res)
    res.json({ ok: true })
  })
}
