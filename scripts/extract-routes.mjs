// Moves whole route registrations out of createApp() in server/index.js into a
// route module that exports `register(app)`.
//
// Route bodies are copied verbatim — only their indentation changes — so the
// diff for each move stays reviewable and no handler logic is touched.
//
//   node scripts/extract-routes.mjs --plan  routes/books.js /api/books
//   node scripts/extract-routes.mjs --apply routes/books.js /api/books /api/podcasts
//
// Path arguments match by prefix.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(root, 'server', 'index.js')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const rest = args.filter((arg) => arg !== '--apply' && arg !== '--plan')
const targetRelative = rest[0]
const prefixes = rest.slice(1)

if (!targetRelative || prefixes.length === 0) {
  console.error('usage: extract-routes.mjs [--plan|--apply] routes/<name>.js /api/prefix ...')
  process.exit(1)
}

const lines = fs.readFileSync(indexPath, 'utf8').split('\n')

// Each registration starts at indent 2 and ends at the first `  })` at indent 2.
const blocks = []
for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(/^ {2}app\.(get|post|patch|put|delete)\(\s*'([^']+)'/)
  if (!match) continue
  let end = index
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^ {2}\}\)$/.test(lines[cursor])) {
      end = cursor
      break
    }
  }
  blocks.push({ method: match[1], path: match[2], start: index, end })
}

const selected = blocks.filter((block) => prefixes.some((prefix) => block.path === prefix || block.path.startsWith(`${prefix}/`)))
if (!selected.length) {
  console.error(`no routes matched: ${prefixes.join(', ')}`)
  process.exit(1)
}

console.log(`target: server/${targetRelative}`)
for (const block of selected) console.log(`  ${block.method.toUpperCase().padEnd(6)} ${block.path}  (${block.end - block.start + 1} lines)`)
console.log(`\n${selected.length} routes, ${selected.reduce((sum, block) => sum + block.end - block.start + 1, 0)} lines`)

if (!apply) {
  console.log('\n(plan only — pass --apply to write)')
  process.exit(0)
}

const body = selected
  .map((block) => lines.slice(block.start, block.end + 1).join('\n'))
  .join('\n\n')

const moduleName = path.basename(targetRelative, '.js')
const registerName = `register${moduleName.replace(/(^|-)([a-z])/g, (_, __, char) => char.toUpperCase())}Routes`

const targetPath = path.join(root, 'server', targetRelative)
fs.mkdirSync(path.dirname(targetPath), { recursive: true })
fs.writeFileSync(targetPath, `export function ${registerName}(app) {\n${body}\n}\n`)

// Replace the moved blocks in index.js with a single register call.
const removed = new Set()
for (const block of selected) for (let line = block.start; line <= block.end; line += 1) removed.add(line)
const firstLine = selected[0].start
const kept = lines
  .map((line, index) => {
    if (index === firstLine) return `  ${registerName}(app)`
    return removed.has(index) ? null : line
  })
  .filter((line) => line !== null)

fs.writeFileSync(indexPath, kept.join('\n').replace(/\n{3,}/g, '\n\n'))

console.log(`\nwrote server/${targetRelative} exporting ${registerName}(app)`)
console.log('add its imports at the top of the new file, import it in server/index.js, then run: npm run verify')
