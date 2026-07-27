// Symbol parity guard for the server module split.
//
// The single largest risk when moving 355 functions out of one file is silently
// dropping or duplicating one. This script collects every top-level function and
// binding across server/**/*.js and compares it with a committed baseline, so a
// lost helper fails loudly instead of surfacing as a runtime error weeks later.
//
//   node scripts/check-server-symbols.mjs            compare against the baseline
//   node scripts/check-server-symbols.mjs --update   rewrite the baseline
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'server')
const baselinePath = path.join(root, 'scripts', 'server-symbols.json')

async function collectFiles(dir) {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full)
  }
  return files.sort()
}

async function collectSymbols() {
  const symbols = new Map()
  const duplicates = []
  for (const file of await collectFiles(serverDir)) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    const lines = (await fs.readFile(file, 'utf8')).split('\n')
    for (const line of lines) {
      const fn = line.match(/^(?:export )?(?:async )?function ([A-Za-z0-9_$]+)/)
      const binding = line.match(/^(?:export )?(?:const|let) ([A-Za-z0-9_$]+)\s*=/)
      const name = fn?.[1] || binding?.[1]
      if (!name) continue
      if (symbols.has(name)) duplicates.push(`${name} (${symbols.get(name)} and ${relative})`)
      else symbols.set(name, relative)
    }
  }
  return { symbols, duplicates }
}

const { symbols, duplicates } = await collectSymbols()
const current = [...symbols.keys()].sort()

if (process.argv.includes('--update')) {
  await fs.writeFile(baselinePath, `${JSON.stringify({ symbols: current }, null, 1)}\n`)
  console.log(`baseline updated: ${current.length} symbols across server/`)
  process.exit(0)
}

let baseline
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8')).symbols
} catch {
  console.error(`no baseline at ${path.relative(root, baselinePath)} — run with --update first`)
  process.exit(1)
}

const baselineSet = new Set(baseline)
const currentSet = new Set(current)
const missing = baseline.filter((name) => !currentSet.has(name))
const added = current.filter((name) => !baselineSet.has(name))

console.log(`server/ top-level symbols: ${current.length} (baseline ${baseline.length})`)
if (duplicates.length) {
  console.error(`\nduplicate definitions (${duplicates.length}):`)
  for (const entry of duplicates) console.error(`  ${entry}`)
}
if (missing.length) {
  console.error(`\nmissing since baseline (${missing.length}):`)
  for (const name of missing) console.error(`  ${name}`)
}
if (added.length) {
  console.log(`\nnew since baseline (${added.length}):`)
  for (const name of added) console.log(`  ${name}`)
}

if (missing.length || duplicates.length) {
  console.error('\nsymbol parity FAILED — a helper was dropped or defined twice during the split')
  process.exit(1)
}
console.log('\nsymbol parity OK')
