// Route manifest guard.
//
// Splitting routes into modules changes the order they are registered in.
// Express matches in registration order, so that is only safe if no two routes
// can match the same concrete URL. This script proves that (or names the pairs
// that break it), and compares the full route list against a committed baseline
// so a route cannot silently go missing during the split.
//
//   node scripts/check-routes.mjs            compare against the baseline
//   node scripts/check-routes.mjs --update   rewrite the baseline
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'server')
const baselinePath = path.join(root, 'scripts', 'server-routes.json')

async function collectFiles(dir) {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full)
  }
  return files.sort()
}

const routes = []
for (const file of await collectFiles(serverDir)) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await fs.readFile(file, 'utf8')
  source.split('\n').forEach((line, index) => {
    const match = line.match(/\bapp\.(get|post|patch|put|delete)\(\s*'([^']+)'/)
    if (match) routes.push({ method: match[1].toUpperCase(), path: match[2], file: relative, line: index + 1 })
  })
}

// Two patterns conflict when they have the same method, the same segment count,
// and every segment either matches literally or is a parameter on one side.
function conflicts(a, b) {
  if (a.method !== b.method) return false
  const left = a.path.split('/')
  const right = b.path.split('/')
  if (left.length !== right.length) return false
  return left.every((segment, index) => {
    const other = right[index]
    if (segment.startsWith(':') || other.startsWith(':')) return true
    return segment === other
  })
}

const shadowing = []
for (let i = 0; i < routes.length; i += 1) {
  for (let j = i + 1; j < routes.length; j += 1) {
    if (conflicts(routes[i], routes[j])) shadowing.push([routes[i], routes[j]])
  }
}

const manifest = routes.map((route) => `${route.method} ${route.path}`).sort()

if (process.argv.includes('--update')) {
  await fs.writeFile(baselinePath, `${JSON.stringify({ routes: manifest }, null, 1)}\n`)
  console.log(`baseline updated: ${manifest.length} routes`)
  process.exit(0)
}

console.log(`registered routes: ${routes.length}`)

if (shadowing.length) {
  console.error(`\noverlapping routes — registration order is significant here (${shadowing.length}):`)
  for (const [a, b] of shadowing) {
    console.error(`  ${a.method} ${a.path} (${a.file}:${a.line})`)
    console.error(`  ${b.method} ${b.path} (${b.file}:${b.line})\n`)
  }
} else {
  console.log('no two routes can match the same URL — module order is not significant')
}

let baseline
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8')).routes
} catch {
  console.error(`\nno baseline at ${path.relative(root, baselinePath)} — run with --update first`)
  process.exit(1)
}

const currentSet = new Set(manifest)
const baselineSet = new Set(baseline)
const missing = baseline.filter((entry) => !currentSet.has(entry))
const added = manifest.filter((entry) => !baselineSet.has(entry))

if (missing.length) {
  console.error(`\nroutes missing since baseline (${missing.length}):`)
  for (const entry of missing) console.error(`  ${entry}`)
}
if (added.length) {
  console.log(`\nnew routes since baseline (${added.length}):`)
  for (const entry of added) console.log(`  ${entry}`)
}

if (missing.length || shadowing.length) {
  console.error('\nroute check FAILED')
  process.exit(1)
}
console.log('\nroute manifest OK')
