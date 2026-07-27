// HTTP application assembly: middleware, route module registration, the error
// handler, and the SPA/dev-server fallback.
//
// The route manifest assertion below exists because the biggest risk when
// splitting routes into modules is silently failing to register one — a missing
// route is invisible until someone uses that feature.
import path from 'node:path'
import express from 'express'
import { isProd, root } from './config.js'
import { ensureStore, readDb, writeDb } from './storage.js'
import { cleanupExpiredLoginAttempts, cleanupExpiredSessions, cleanupRateLimitBuckets } from './ratelimit.js'
import { refreshAiServiceConfig } from './ai-runtime.js'
import { recoverInterruptedJobs } from './jobs.js'
import { appendErrorLog } from './telemetry.js'
import { ensureInitialAdmin } from './bootstrap.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerMicroRoutes } from './routes/micro.js'
import { registerBooksRoutes } from './routes/books.js'
import { registerPodcastsRoutes } from './routes/podcasts.js'
import { registerUnitsRoutes } from './routes/units.js'
import { registerJobsRoutes } from './routes/jobs.js'
import { registerVocabularyRoutes } from './routes/vocabulary.js'

// Every route the application is expected to serve. Kept in sync by
// scripts/check-routes.mjs; a mismatch fails startup rather than at first use.
const EXPECTED_ROUTE_COUNT = 44

function assertRoutesRegistered(app) {
  const registered = new Set()
  for (const layer of app.router?.stack || app._router?.stack || []) {
    if (!layer.route || typeof layer.route.path !== 'string') continue
    // Only API routes are tracked; the SPA fallback is a catch-all, not a route.
    if (!layer.route.path.startsWith('/api/')) continue
    for (const method of Object.keys(layer.route.methods || {})) {
      registered.add(`${method.toUpperCase()} ${layer.route.path}`)
    }
  }
  if (registered.size !== EXPECTED_ROUTE_COUNT) {
    throw new Error(
      `路由注册数量异常：期望 ${EXPECTED_ROUTE_COUNT} 条，实际 ${registered.size} 条。` +
        '某个路由模块可能没有被挂载；运行 npm run check:routes 查看清单。',
    )
  }
  return registered
}

export async function createApp() {
  await ensureStore()
  await refreshAiServiceConfig()
  await ensureInitialAdmin()
  await recoverInterruptedJobs()
  cleanupExpiredLoginAttempts()
  cleanupExpiredSessions().catch((error) => console.error('session cleanup failed', error))
  const maintenanceTimer = setInterval(() => {
    cleanupExpiredLoginAttempts()
    cleanupRateLimitBuckets()
    cleanupExpiredSessions().catch((error) => console.error('session cleanup failed', error))
  }, 10 * 60 * 1000)
  maintenanceTimer.unref?.()
  const app = express()
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : Number(process.env.TRUST_PROXY) || false)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self' https: ws: wss:",
        "manifest-src 'self'",
        "form-action 'self'",
      ].join('; ')
    )
    next()
  })
  app.use(express.json({ limit: '2mb' }))

  registerHealthRoutes(app)

  registerAuthRoutes(app)

  registerAdminRoutes(app)

  registerMicroRoutes(app)

  registerBooksRoutes(app)

  registerPodcastsRoutes(app)

  registerUnitsRoutes(app)

  registerJobsRoutes(app)

  registerVocabularyRoutes(app)

  app.use((error, req, res, _next) => {
    console.error(error)
    const statusValue = Number(error.status || error.statusCode || 500)
    const status = Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : 500
    if (status >= 500) {
      ;(async () => {
        try {
          const db = req.db || (await readDb())
          appendErrorLog(db, {
            scope: 'server',
            message: error.message || '服务器出现错误',
            detail: `${req.method || ''} ${req.originalUrl || req.url || ''}`.trim(),
            userId: req.user?.id || '',
            statusCode: status,
            errorCode: 'server-error',
          })
          await writeDb(db)
        } catch (logError) {
          console.error('failed to write error log', logError)
        }
      })()
    }
    const message = status >= 500 && isProd ? '服务器出现错误' : error.message || '服务器出现错误'
    res.status(status).json({ error: message })
  })

  if (isProd) {
    app.use(express.static(path.join(root, 'dist')))
    app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  assertRoutesRegistered(app)

  return app
}
