// Catches the failure mode that dominates a module split: a function that was
// moved out of index.js is still called somewhere, but nobody imported it.
//
// Such a file parses fine and starts fine — it only throws when that specific
// request runs, which is exactly the kind of bug an extraction is supposed not
// to introduce. This scans call sites in every server module and reports any
// callee that is neither imported, declared locally, nor a known global.
//
// Run with: node scripts/check-server-imports.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, 'server')

const GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Buffer', 'Date', 'Error', 'Function', 'Infinity', 'Int16Array',
  'Int32Array', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp',
  'Set', 'String', 'Symbol', 'TextDecoder', 'TextEncoder', 'Uint8Array', 'Uint8ClampedArray', 'URL', 'URLSearchParams',
  'WeakMap', 'WeakSet', 'AbortController', 'Blob', 'FormData', 'Headers', 'Request', 'Response',
  'clearInterval', 'clearTimeout', 'decodeURIComponent', 'encodeURIComponent', 'fetch', 'isFinite', 'isNaN',
  'parseFloat', 'parseInt', 'queueMicrotask', 'require', 'setInterval', 'setTimeout', 'structuredClone',
  'console', 'process', 'globalThis', 'super', 'this', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
  'function', 'await', 'new', 'do', 'else', 'yield', 'import', 'delete', 'void', 'in', 'of', 'instanceof', 'async',
])

async function collectFiles(dir) {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full)
  }
  return files.sort()
}

// Names a file can legitimately call: imports, any declaration at any depth,
// function parameters and destructured bindings.
function knownNames(source) {
  const known = new Set()

  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) known.add(name)
    }
  }
  for (const match of source.matchAll(/import\s+([A-Za-z0-9_$]+)(?:\s*,|\s+from)/g)) known.add(match[1])
  for (const match of source.matchAll(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)/g)) known.add(match[1])

  for (const match of source.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g)) known.add(match[1])
  for (const match of source.matchAll(/(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) known.add(match[1])
  for (const match of source.matchAll(/(?:^|\s)class\s+([A-Za-z0-9_$]+)/g)) known.add(match[1])

  // Destructuring targets and parameters: over-approximate on purpose, a false
  // "known" is far cheaper here than a false alarm on every arrow function.
  for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':').pop()?.split('=')[0]?.trim()
      if (name && /^[A-Za-z0-9_$]+$/.test(name)) known.add(name)
    }
  }
  // Only treat a parenthesised list as a parameter list when it really looks
  // like one. Without this guard `app.post('/x', auth, async (req) => {}` reads
  // as if `auth` were a parameter, which would hide a genuinely missing import.
  const addParameters = (raw) => {
    if (/['"`]/.test(raw)) return
    for (const part of raw.split(',')) {
      const name = part.split('=')[0].replace(/[{}[\].:]/g, ' ').trim().split(/\s+/).pop()
      if (name && /^[A-Za-z0-9_$]+$/.test(name)) known.add(name)
    }
  }
  // Arrow parameters: walk back from `=>` to the matching '(' so a nested arrow
  // inside a call argument list yields its own parameters, not the whole call.
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] !== '=' || source[index + 1] !== '>') continue
    let cursor = index - 1
    while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1
    if (source[cursor] !== ')') continue
    let depth = 0
    let start = cursor
    for (; start >= 0; start -= 1) {
      if (source[start] === ')') depth += 1
      else if (source[start] === '(') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (start >= 0) addParameters(source.slice(start + 1, cursor))
  }
  for (const match of source.matchAll(/function[^(]*\(([^)]*)\)/g)) addParameters(match[1])
  for (const match of source.matchAll(/([A-Za-z0-9_$]+)\s*=>/g)) known.add(match[1])
  for (const match of source.matchAll(/catch\s*\(\s*([A-Za-z0-9_$]+)/g)) known.add(match[1])

  return known
}

// Blanks out comments, string/template literals and regex literals so words
// inside SQL, prompts and patterns are never mistaken for call sites.
function stripLiterals(source) {
  let output = ''
  let index = 0
  let previousMeaningful = ''
  let previousWord = ''
  let currentWord = ''
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') output += '\n'
        index += 1
      }
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      const quote = char
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') index += 1
        else if (source[index] === '\n') output += '\n'
        index += 1
      }
      index += 1
      output += '""'
      continue
    }
    // Template literals: blank the text but keep ${...} substitutions, which are
    // real code and a very common place for a missed import to hide.
    if (char === '`') {
      index += 1
      let depth = 0
      while (index < source.length) {
        const current = source[index]
        if (depth === 0 && current === '`') break
        if (current === '\\') {
          index += 2
          continue
        }
        if (depth === 0 && current === '$' && source[index + 1] === '{') {
          depth = 1
          output += ' ('
          index += 2
          continue
        }
        if (depth > 0) {
          if (current === '{') depth += 1
          if (current === '}') {
            depth -= 1
            if (depth === 0) {
              output += ') '
              index += 1
              continue
            }
          }
          output += current
          index += 1
          continue
        }
        if (current === '\n') output += '\n'
        index += 1
      }
      index += 1
      continue
    }
    // A '/' starts a regex only where a value is expected. After an operand it is
    // division — except when that "operand" is actually a keyword like `return`.
    const afterKeyword = /\b(return|typeof|case|delete|void|in|of|new|do|else|yield|await|instanceof)$/.test(previousWord)
    if (char === '/' && (afterKeyword || !/[A-Za-z0-9_$)\]]/.test(previousMeaningful))) {
      index += 1
      while (index < source.length && source[index] !== '/') {
        if (source[index] === '\\') index += 1
        else if (source[index] === '[') {
          while (index < source.length && source[index] !== ']') index += 1
        }
        index += 1
      }
      index += 1
      while (index < source.length && /[gimsuy]/.test(source[index])) index += 1
      output += '/RE/'
      continue
    }

    output += char
    if (!/\s/.test(char)) previousMeaningful = char
    if (/[A-Za-z0-9_$]/.test(char)) {
      currentWord += char
    } else {
      if (currentWord) previousWord = currentWord
      currentWord = ''
      // Whitespace keeps the preceding word visible; punctuation does not.
      if (!/\s/.test(char)) previousWord = ''
    }
    index += 1
  }
  return output
}

// A second, exact pass: every symbol some other server module exports is a name
// with known meaning. If a file mentions one without importing it and without
// declaring its own, that is a missed import — including value references like a
// config constant, which the call-site scan above cannot see.
const files = await collectFiles(serverDir)
const exportsByFile = new Map()
for (const file of files) {
  const source = await fs.readFile(file, 'utf8')
  const names = new Set()
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1])
  }
  exportsByFile.set(file, names)
}

let problems = 0
const missingImports = new Map()
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await fs.readFile(file, 'utf8')
  const known = knownNames(source)
  const body = stripLiterals(source)
    .split('\n')
    .filter((line) => !/^\s*(import|export)\s/.test(line) && !/^\s*\}\s*from\s/.test(line))
    .join('\n')
  const mentioned = new Set(body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [])

  // Node builtins are namespace objects: referencing `path.` without importing
  // `path` is the same class of mistake and is just as silent.
  for (const builtin of ['path', 'fs', 'fsSync', 'crypto', 'os', 'multer', 'express', 'lamejs', 'nanoid', 'JSZip']) {
    if (known.has(builtin)) continue
    if (!new RegExp(`(^|[^.\\w$])${builtin}\\s*[.(]`).test(body)) continue
    problems += 1
    console.error(`${relative}  uses '${builtin}' but never imports it`)
  }

  for (const [otherFile, names] of exportsByFile) {
    if (otherFile === file) continue
    for (const name of names) {
      if (!mentioned.has(name) || known.has(name)) continue
      // Skip property access (obj.name) and shorthand keys — but the leading dots
      // of a spread (`...name`) are not property access.
      const asValue = new RegExp(`(^|\\.\\.\\.|[^.\\w$])${name}\\b(?!\\s*:)`).test(body)
      if (!asValue) continue
      problems += 1
      const specifier = `./${path.relative(path.dirname(file), otherFile).split(path.sep).join('/')}`
      if (!missingImports.has(file)) missingImports.set(file, new Map())
      const perModule = missingImports.get(file)
      if (!perModule.has(specifier)) perModule.set(specifier, new Set())
      perModule.get(specifier).add(name)
      console.error(
        `${relative}  uses '${name}' from ${path.relative(root, otherFile).split(path.sep).join('/')} but never imports it`,
      )
    }
  }
}

// `--fix` writes the missing import statements. The set of names comes from the
// exact pass above, so this only ever adds imports that are provably needed.
if (process.argv.includes('--fix') && missingImports.size) {
  for (const [file, perModule] of missingImports) {
    let source = await fs.readFile(file, 'utf8')
    const statements = [...perModule]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([specifier, names]) => {
        const sorted = [...names].sort()
        return sorted.length > 3
          ? `import {\n${sorted.map((name) => `  ${name},`).join('\n')}\n} from '${specifier}'`
          : `import { ${sorted.join(', ')} } from '${specifier}'`
      })

    const sourceLines = source.split('\n')
    let lastImport = -1
    let depth = 0
    for (let index = 0; index < sourceLines.length; index += 1) {
      const line = sourceLines[index]
      if (depth === 0 && /^import\s/.test(line)) {
        lastImport = index
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      } else if (depth > 0) {
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
        lastImport = index
      }
    }
    // A file with no imports yet gets them after its leading comment block.
    if (lastImport === -1) {
      let insertAt = 0
      while (insertAt < sourceLines.length && /^\s*(\/\/|$)/.test(sourceLines[insertAt])) insertAt += 1
      sourceLines.splice(insertAt, 0, ...statements, '')
    } else {
      sourceLines.splice(lastImport + 1, 0, ...statements)
    }
    await fs.writeFile(file, sourceLines.join('\n'))
    console.log(`fixed imports in ${path.relative(root, file).split(path.sep).join('/')}`)
  }
  console.log('\nre-run without --fix to confirm')
  process.exit(0)
}

for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = await fs.readFile(file, 'utf8')
  const known = knownNames(source)
  const reported = new Set()
  const lines = stripLiterals(source).split('\n')

  lines.forEach((line, index) => {
    const code = line
    if (/^\s*import\s/.test(code)) return
    if (/^\s*(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{\s*$/.test(code)) return
    for (const match of code.matchAll(/(^|[^.\w$'"`])([a-zA-Z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = match[2]
      if (known.has(name) || GLOBALS.has(name) || reported.has(name)) continue
      reported.add(name)
      problems += 1
      console.error(`${relative}:${index + 1}  calls '${name}' but never imports or declares it`)
    }
  })
}

if (problems) {
  console.error(`\nunresolved call targets: ${problems}`)
  process.exit(1)
}
console.log('server import check OK — every call target is imported or declared')
