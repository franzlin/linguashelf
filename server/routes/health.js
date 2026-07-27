import { deployRevision, storageDriver } from './../config.js'
import { storageHealth } from './../storage.js'

export function registerHealthRoutes(app) {
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      storageDriver,
      version: process.env.npm_package_version || '0.0.0',
      revision: deployRevision,
    })
  })

  app.get('/api/ready', async (_req, res, next) => {
    try {
      res.json(await storageHealth())
    } catch (error) {
      next(error)
    }
  })
}
