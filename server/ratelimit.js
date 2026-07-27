// Login throttling, session expiry and per-user action quotas.
//
// All counters are in-process. Moving them to shared storage is a prerequisite
// for running more than one instance; see SERVER_MODULARIZATION_PLAN.md.
import { aiRateLimits, loginMaxFailures, loginWindowMs, rateLimitWindowMs, sessionDays } from './config.js'
import { readDb, writeDb } from './storage.js'

export const loginAttempts = new Map()

export const actionRateBuckets = new Map()

export function sessionExpiresAt(session) {
  if (session.expiresAt) return Date.parse(session.expiresAt)
  return Date.parse(session.createdAt || '') + sessionDays * 24 * 60 * 60 * 1000
}

export function isSessionExpired(session) {
  return Number.isFinite(sessionExpiresAt(session)) && sessionExpiresAt(session) <= Date.now()
}

export function loginAttemptKey(req, email) {
  return `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`
}

export function loginLimitStatus(req, email) {
  const key = loginAttemptKey(req, email)
  const now = Date.now()
  const attempt = loginAttempts.get(key)
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(key)
    return { limited: false, key, remaining: loginMaxFailures }
  }
  return {
    limited: attempt.count >= loginMaxFailures,
    key,
    remaining: Math.max(0, loginMaxFailures - attempt.count),
    resetAt: attempt.resetAt,
  }
}

export function recordLoginFailure(key) {
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs })
    return
  }
  current.count += 1
}

export function clearLoginFailures(key) {
  loginAttempts.delete(key)
}

export function cleanupExpiredLoginAttempts(now = Date.now()) {
  for (const [key, attempt] of loginAttempts) {
    if (!attempt?.resetAt || attempt.resetAt <= now) loginAttempts.delete(key)
  }
}

export function cleanupRateLimitBuckets(now = Date.now()) {
  for (const [key, bucket] of actionRateBuckets) {
    if (!bucket?.resetAt || bucket.resetAt <= now) actionRateBuckets.delete(key)
  }
}

export async function cleanupExpiredSessions() {
  const db = await readDb()
  const before = db.sessions.length
  db.sessions = db.sessions.filter((session) => !isSessionExpired(session))
  if (db.sessions.length !== before) await writeDb(db)
}

export function rateLimitKey(userId, action) {
  return `${action}:${userId}`
}

export function applyRateLimitHeaders(res, limit, bucket) {
  res.setHeader('X-RateLimit-Limit', String(limit.max))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit.max - bucket.count)))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))
}

export function consumeUserQuota(req, res, action, cost = 1) {
  const limit = aiRateLimits[action]
  if (!limit || limit.max <= 0 || cost <= 0) return true

  const now = Date.now()
  cleanupRateLimitBuckets(now)
  const key = rateLimitKey(req.user.id, action)
  let bucket = actionRateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + limit.windowMs }
    actionRateBuckets.set(key, bucket)
  }

  if (bucket.count + cost > limit.max) {
    applyRateLimitHeaders(res, limit, bucket)
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
    res.status(429).json({ error: '操作太频繁，请稍后再试' })
    return false
  }

  bucket.count += cost
  applyRateLimitHeaders(res, limit, bucket)
  return true
}
