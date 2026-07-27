// Dependency analysis for the planned server/index.js module split.
//
// Reports the top-level symbol graph, the proposed module boundaries, and —
// most importantly — any bidirectional dependencies that would turn into
// circular imports once the split happens. See SERVER_MODULARIZATION_PLAN.md.
//
// Run with: node scripts/analyze-server-deps.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8')
const lines = source.split('\n')

// Proposed module boundaries, expressed as line ranges in the current file.
// Update these as the split progresses; the cycle report is only meaningful
// while they still describe reality.
const MODULES = [
  ['infra/config', 1, 137],
  ['infra/storage', 138, 401],
  ['infra/http', 402, 480],
  ['infra/session', 481, 552],
  ['infra/ratelimit', 553, 597],
  ['ai/config-glue', 598, 726],
  ['infra/users', 727, 957],
  ['text-util', 958, 1057],
  ['parsing/epub', 1058, 1290],
  ['parsing/pdf', 1291, 1501],
  ['parsing/ocr', 1502, 1728],
  ['domain/units', 1729, 2120],
  ['domain/content', 2121, 2513],
  ['ai/tts', 2514, 3147],
  ['ai/services', 3148, 3510],
  ['domain/podcast', 3511, 3821],
  ['domain/progress', 3822, 4013],
  ['domain/stats', 4014, 4338],
  ['domain/quality', 4339, 4834],
  ['domain/micro', 4835, 5453],
  ['domain/repair', 5454, 5628],
  ['jobs/diagnosis', 5629, 5968],
  ['infra/admin-report', 5969, 6338],
  ['jobs/queue', 6339, 7134],
  ['routes', 7135, 8830],
]

const declarations = []
lines.forEach((line, index) => {
  const fn = line.match(/^(?:async )?function ([A-Za-z0-9_$]+)/)
  if (fn) {
    declarations.push({ name: fn[1], line: index + 1, kind: 'function' })
    return
  }
  const binding = line.match(/^(const|let) ([A-Za-z0-9_$]+)\s*=/)
  if (binding) declarations.push({ name: binding[2], line: index + 1, kind: binding[1] === 'let' ? 'state' : 'const' })
})

const functions = declarations.filter((item) => item.kind === 'function')
for (const fn of functions) {
  fn.end = lines.length
  for (let cursor = fn.line; cursor < lines.length; cursor += 1) {
    if (lines[cursor] === '}') {
      fn.end = cursor + 1
      break
    }
  }
}

const byName = new Map(declarations.map((item) => [item.name, item]))

function moduleOf(name) {
  const declaration = byName.get(name)
  if (!declaration) return null
  for (const [id, start, end] of MODULES) {
    if (declaration.line >= start && declaration.line <= end) return id
  }
  return 'unmapped'
}

const crossModule = new Map()
for (const fn of functions) {
  const from = moduleOf(fn.name)
  const body = lines.slice(fn.line, fn.end).join('\n')
  const referenced = new Set()
  for (const token of body.match(/[A-Za-z0-9_$]+/g) || []) {
    if (token !== fn.name && byName.has(token)) referenced.add(token)
  }
  for (const target of referenced) {
    const to = moduleOf(target)
    if (!from || !to || from === to) continue
    const key = `${from} -> ${to}`
    if (!crossModule.has(key)) crossModule.set(key, new Set())
    crossModule.get(key).add(target)
  }
}

const outgoing = new Map()
for (const key of crossModule.keys()) {
  const [from, to] = key.split(' -> ')
  if (!outgoing.has(from)) outgoing.set(from, new Set())
  outgoing.get(from).add(to)
}

const cycles = []
for (const [from, targets] of outgoing) {
  for (const to of targets) {
    if (outgoing.get(to)?.has(from) && from < to) cycles.push([from, to])
  }
}

console.log(`server/index.js: ${lines.length} lines`)
console.log(
  `top-level symbols: ${functions.length} functions, ` +
    `${declarations.filter((item) => item.kind === 'const').length} constants, ` +
    `${declarations.filter((item) => item.kind === 'state').length} mutable`,
)

const inbound = new Map()
for (const [key, symbols] of crossModule) {
  const to = key.split(' -> ')[1]
  inbound.set(to, (inbound.get(to) || 0) + symbols.size)
}
console.log('\nmost depended-on modules (extract these first):')
for (const [id, count] of [...inbound].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${id.padEnd(20)} ${count} inbound references`)
}

console.log(`\ncircular dependencies: ${cycles.length}`)
for (const [from, to] of cycles) {
  console.log(`\n  ${from} <-> ${to}`)
  console.log(`    ${from} needs: ${[...crossModule.get(`${from} -> ${to}`)].join(', ')}`)
  console.log(`    ${to} needs: ${[...crossModule.get(`${to} -> ${from}`)].join(', ')}`)
}

if (cycles.length === 0) console.log('  none — the proposed boundaries are safe to split along')
