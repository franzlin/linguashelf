// Extraction helper for the server module split.
//
// Given a list of top-level symbol names, this moves them out of
// server/index.js into a new module, adds the export/import wiring, and reports
// which symbols the new module still needs from elsewhere so the dependency
// direction can be checked before committing.
//
//   node scripts/extract-module.mjs --plan  <target.js> name1 name2 ...
//   node scripts/extract-module.mjs --apply <target.js> name1 name2 ...
//
// --plan never writes; use it to inspect the dependency closure first.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(root, 'server', 'index.js')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const rest = args.filter((arg) => arg !== '--apply' && arg !== '--plan')
const targetRelative = rest[0]
const wanted = rest.slice(1)

if (!targetRelative || wanted.length === 0) {
  console.error('usage: extract-module.mjs [--plan|--apply] server/<target>.js <symbol>...')
  process.exit(1)
}

const source = fs.readFileSync(indexPath, 'utf8')
const lines = source.split('\n')

// Symbols already living in sibling modules. Without this the dependency report
// silently misses anything an earlier phase moved out, which produces a module
// that parses fine but throws at runtime.
const siblingSymbols = new Map()
for (const entry of fs.readdirSync(path.join(root, 'server'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'index.js') continue
  const text = fs.readFileSync(path.join(root, 'server', entry.name), 'utf8')
  for (const match of text.matchAll(/^export (?:async )?(?:function|const|let) ([A-Za-z0-9_$]+)/gm)) {
    siblingSymbols.set(match[1], `./${entry.name}`)
  }
}

// Locate every top-level declaration and the exact line span it occupies.
const declarations = []
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  const fn = line.match(/^(?:async )?function ([A-Za-z0-9_$]+)/)
  if (fn) {
    let end = index
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] === '}') {
        end = cursor
        break
      }
    }
    declarations.push({ name: fn[1], start: index, end, kind: 'function' })
    continue
  }
  const binding = line.match(/^(const|let) ([A-Za-z0-9_$]+)\s*=/)
  if (binding) {
    // Multi-line object/array literals end at a line that closes at column 0.
    let end = index
    const opensBlock = /[[{(]\s*$/.test(line)
    if (opensBlock) {
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^[\]})]/.test(lines[cursor])) {
          end = cursor
          break
        }
      }
    }
    declarations.push({ name: binding[2], start: index, end, kind: binding[1] })
  }
}

const byName = new Map(declarations.map((item) => [item.name, item]))
const missing = wanted.filter((name) => !byName.has(name))
if (missing.length) {
  console.error(`not found in server/index.js: ${missing.join(', ')}`)
  process.exit(1)
}

const moving = new Set(wanted)

// What do the moved symbols still reference from index.js?
const externalNeeds = new Set()
const importedNames = new Set()
for (const line of lines) {
  const named = line.match(/^import \{([^}]+)\} from/)
  if (named) for (const part of named[1].split(',')) importedNames.add(part.trim().split(' as ')[0].trim())
  const def = line.match(/^import ([A-Za-z0-9_$]+)(?:,|\s+from)/)
  if (def) importedNames.add(def[1])
}

for (const name of moving) {
  const declaration = byName.get(name)
  const body = lines.slice(declaration.start, declaration.end + 1).join('\n')
  for (const token of body.match(/[A-Za-z0-9_$]+/g) || []) {
    if (token === name || moving.has(token)) continue
    if (byName.has(token) || importedNames.has(token) || siblingSymbols.has(token)) externalNeeds.add(token)
  }
}

// What does the rest of index.js still need from the moved symbols?
const stillUsed = new Set()
const movedRanges = [...moving].map((name) => byName.get(name))
const remaining = lines
  .filter((_, index) => !movedRanges.some((range) => index >= range.start && index <= range.end))
  .join('\n')
for (const name of moving) {
  const pattern = new RegExp(`\\b${name}\\b`)
  if (pattern.test(remaining)) stillUsed.add(name)
}

console.log(`target: ${targetRelative}`)
console.log(`moving ${moving.size} symbols, ${movedRanges.reduce((sum, r) => sum + (r.end - r.start + 1), 0)} lines`)
console.log(`\nstill needed by index.js (will be imported back): ${[...stillUsed].sort().join(', ') || 'none'}`)
const fromSiblings = [...externalNeeds].filter((name) => siblingSymbols.has(name)).sort()
const fromIndex = [...externalNeeds].filter((name) => !siblingSymbols.has(name)).sort()
console.log(`\nnew module needs from sibling modules: ${fromSiblings.map((name) => `${name} (${siblingSymbols.get(name)})`).join(', ') || 'none'}`)
console.log(`new module needs from index.js/externals: ${fromIndex.join(', ') || 'none'}`)

if (!apply) {
  console.log('\n(plan only — pass --apply to write)')
  process.exit(0)
}

// Write the new module: moved bodies, exported, in their original order.
const ordered = [...moving].map((name) => byName.get(name)).sort((a, b) => a.start - b.start)
const movedText = ordered
  .map((declaration) => {
    const body = lines.slice(declaration.start, declaration.end + 1).join('\n')
    return body.startsWith('export ') ? body : `export ${body}`
  })
  .join('\n\n')

fs.writeFileSync(path.join(root, targetRelative), `${movedText}\n`)

// Remove the moved lines from index.js and import back whatever it still uses.
// Generating the import here rather than by hand is deliberate: a symbol that is
// used but not imported parses cleanly and only fails at request time.
const keep = lines.filter((_, index) => !ordered.some((range) => index >= range.start && index <= range.end))
let updated = keep.join('\n').replace(/\n{3,}/g, '\n\n')

const moduleSpecifier = `./${path.basename(targetRelative)}`
if (stillUsed.size) {
  const names = [...stillUsed].sort()
  const statement =
    names.length > 3
      ? `import {\n${names.map((name) => `  ${name},`).join('\n')}\n} from '${moduleSpecifier}'`
      : `import { ${names.join(', ')} } from '${moduleSpecifier}'`

  const importLines = updated.split('\n')
  let lastImport = -1
  let depth = 0
  for (let index = 0; index < importLines.length; index += 1) {
    const line = importLines[index]
    if (depth === 0 && /^import /.test(line)) {
      lastImport = index
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
    } else if (depth > 0) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      lastImport = index
    }
  }
  if (lastImport === -1) throw new Error('could not locate the import block in server/index.js')
  importLines.splice(lastImport + 1, 0, statement)
  updated = importLines.join('\n')
}

fs.writeFileSync(indexPath, updated)

console.log(`\nwrote ${targetRelative}`)
if (stillUsed.size) console.log(`imported ${stillUsed.size} symbols back into server/index.js`)
console.log('now add the new module\'s own imports at its top, then run: npm run verify')
