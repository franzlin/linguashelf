import 'dotenv/config'
import { port } from './config.js'
import { closeStore } from './storage.js'
import { createApp } from './app.js'
import { runReplanBookCli } from './replan-cli.js'

// Entry point: pick the CLI path or start the HTTP server, and shut down
// cleanly so SQLite is always closed.
if (process.argv.includes('--replan-book')) {
  runReplanBookCli().catch((error) => {
    console.error(error)
    closeStore()
    process.exit(1)
  })
} else {
  createApp().then((app) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`LinguaShelf running at http://localhost:${port}`)
    })

    function shutdown(signal) {
      console.log(`Received ${signal}, shutting down...`)
      server.close(() => {
        closeStore()
        process.exit(0)
      })
      setTimeout(() => {
        closeStore()
        process.exit(1)
      }, 10000).unref()
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
}
