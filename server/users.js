// Password hashing, session cookies and the auth/requireAdmin middleware.
//
// Password verification runs on the libuv thread pool (promisified pbkdf2) so a
// 600k-iteration hash never blocks the event loop.
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { nanoid } from 'nanoid'
import { allowSignup, passwordMinLength, passwordPbkdf2Iterations, sessionCookieName, sessionDays, signupInviteCode } from './config.js'
import { readDb, writeDb } from './storage.js'
import { isSessionExpired, sessionExpiresAt } from './ratelimit.js'

export const pbkdf2Async = promisify(crypto.pbkdf2)

export function canCreateUser(inviteCode) {
  if (signupInviteCode) return inviteCode === signupInviteCode
  return allowSignup
}

export function validatePasswordStrength(password) {
  if (String(password || '').length < passwordMinLength) return `密码至少需要 ${passwordMinLength} 个字符`
  return ''
}

export async function derivePasswordHash(password, salt, iterations) {
  return (await pbkdf2Async(password, salt, iterations, 32, 'sha256')).toString('hex')
}

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = passwordPbkdf2Iterations) {
  const hash = await derivePasswordHash(password, salt, iterations)
  return `pbkdf2-sha256$${iterations}$${salt}$${hash}`
}

export async function verifyPassword(password, stored) {
  const value = String(stored || '')
  let salt = ''
  let hash = ''
  let iterations = 100_000
  if (value.startsWith('pbkdf2-sha256$')) {
    const [, rawIterations, storedSalt, storedHash] = value.split('$')
    iterations = Number(rawIterations)
    salt = storedSalt
    hash = storedHash
  } else {
    ;[salt, hash] = value.split(':')
  }
  if (!salt || !hash || !Number.isInteger(iterations) || iterations < 1) return false
  const candidate = await derivePasswordHash(password, salt, iterations)
  const expected = Buffer.from(hash, 'hex')
  const actual = Buffer.from(candidate, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected)
}

export function passwordHashNeedsUpgrade(stored) {
  const value = String(stored || '')
  if (!value.startsWith('pbkdf2-sha256$')) return true
  const iterations = Number(value.split('$')[1])
  return !Number.isInteger(iterations) || iterations < passwordPbkdf2Iterations
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

export function requestCookie(req, name) {
  const header = String(req.headers.cookie || '')
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    if (key !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

export function secureRequest(req) {
  return Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https')
}

export function setSessionCookie(req, res, token, expiresAt) {
  const expiresAtMs = Date.parse(expiresAt || '')
  const maxAge = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : sessionDays * 24 * 60 * 60 * 1000
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureRequest(req),
    path: '/',
    maxAge,
  })
}

export function clearSessionCookie(req, res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureRequest(req),
    path: '/',
  })
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'user',
    createdAt: user.createdAt,
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
}

export async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : ''
  const cookieToken = requestCookie(req, sessionCookieName)
  const candidates = [
    ...(cookieToken ? [{ token: cookieToken, source: 'cookie' }] : []),
    ...(bearerToken && bearerToken !== cookieToken ? [{ token: bearerToken, source: 'bearer' }] : []),
  ]
  if (!candidates.length) {
    res.status(401).json({ error: '需要登录' })
    return
  }

  const db = await readDb()
  let selected = null
  let changed = false
  for (const candidate of candidates) {
    const tokenHash = hashSessionToken(candidate.token)
    const session = db.sessions.find((item) => item.tokenHash === tokenHash || item.token === candidate.token)
    const user = session ? db.users.find((item) => item.id === session.userId) : null
    if (!session || !user) {
      if (session && !user) {
        db.sessions = db.sessions.filter((item) => item !== session)
        changed = true
      }
      continue
    }
    if (isSessionExpired(session)) {
      db.sessions = db.sessions.filter((item) => item !== session)
      changed = true
      continue
    }
    selected = { ...candidate, tokenHash, session, user }
    break
  }

  if (!selected) {
    if (changed) await writeDb(db)
    if (cookieToken) clearSessionCookie(req, res)
    res.status(401).json({ error: '登录已失效' })
    return
  }

  const { token, tokenHash, session, user, source } = selected
  if (!session.tokenHash || session.token) {
    session.tokenHash = tokenHash
    delete session.token
    changed = true
  }
  if (changed) await writeDb(db)
  if (source !== 'cookie') setSessionCookie(req, res, token, session.expiresAt)

  req.user = user
  req.sessionTokenHash = tokenHash
  req.db = db
  next()
}
