// Integration test: a real server instance driven against fake upstream AI
// endpoints, proving the web-managed custom API configuration takes effect
// without a restart and never leaks the stored key.
//
// Run with: node scripts/test-custom-ai-endpoint.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linguashelf-aicfg-'))
const port = 5820 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const email = 'aicfg@example.com'
const password = 'reader12345'

let passed = 0
let failed = 0
const cleanups = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// A fake OpenAI-compatible service. `dialect` decides which routes exist so we
// can simulate both a full Responses-API provider and a chat-only relay.
async function startFakeAi({ dialect, definition }) {
  const requests = []
  const server = createServer(async (req, res) => {
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {}
    requests.push({ url: req.url, authorization: req.headers.authorization, body })

    const payload = JSON.stringify(definition)

    if (req.url === '/v1/responses') {
      if (dialect === 'chat-only' || dialect === 'chat-no-schema') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unknown path /v1/responses' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ output_text: body.max_output_tokens === 16 ? 'OK' : payload }))
      return
    }

    if (req.url === '/v1/chat/completions') {
      if (dialect === 'responses-only') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unknown path' } }))
        return
      }
      if (dialect === 'chat-no-schema' && body.response_format?.type === 'json_schema') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'response_format json_schema is not supported by this model' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${payload}\n\`\`\`` } }] }))
      return
    }

    res.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(() => new Promise((resolve) => server.close(resolve)))
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }
}

async function startFakeDashscope() {
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/services/audio/tts/SpeechSynthesizer') {
      const body = JSON.parse((await readBody(req)) || '{}')
      requests.push({ authorization: req.headers.authorization, body })
      const { port: selfPort } = server.address()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ output: { audio: { url: `http://127.0.0.1:${selfPort}/audio/test.pcm` } } }))
      return
    }
    if (req.method === 'GET' && req.url === '/audio/test.pcm') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.alloc(48_000))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(() => new Promise((resolve) => server.close(resolve)))
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` }
}

const envDashscope = await startFakeDashscope()
const customDashscope = await startFakeDashscope()

const envAi = await startFakeAi({
  dialect: 'responses-only',
  definition: { term: 'sovereign', meaningZh: '来自环境变量的释义', simpleEnglish: 'A ruler with full power.' },
})
const customAi = await startFakeAi({
  dialect: 'chat-no-schema',
  definition: { term: 'sovereign', meaningZh: '来自自定义端点的释义', simpleEnglish: 'A ruler who answers to no one.' },
})

const server = spawn(process.execPath, ['server/index.js', '--prod'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: 'production',
    STORAGE_DRIVER: 'sqlite',
    ALLOW_SIGNUP: 'true',
    SESSION_SECRET: 'ai-config-integration-test-secret',
    INITIAL_ADMIN_EMAIL: email,
    INITIAL_ADMIN_PASSWORD: password,
    AI_PROVIDER: 'auto',
    OPENAI_BASE_URL: envAi.baseUrl,
    OPENAI_API_KEY: 'env-key-should-not-leak',
    OPENAI_MODEL: 'env-model',
    QUALITY_AUDIT_MODE: 'off',
    DASHSCOPE_TTS_BASE_URL: envDashscope.baseUrl,
    DASHSCOPE_TTS_API_KEY: 'env-dashscope-key-should-not-leak',
    DASHSCOPE_TTS_MODEL: 'env-qwen-model',
    PDF_OCR_VISION_BASE_URL: 'https://env-ocr.test',
    PDF_OCR_VISION_API_KEY: 'env-ocr-key-should-not-leak',
    PDF_OCR_VISION_MODEL: 'env-ocr-model',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (chunk) => serverLog.push(String(chunk)))
server.stderr.on('data', (chunk) => serverLog.push(String(chunk)))
cleanups.push(async () => {
  server.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 300))
})

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server did not start\n${serverLog.join('')}`)
}

let cookie = ''

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

try {
  console.log('Custom AI endpoint integration tests')
  await waitForServer()

  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  check('admin can log in', login.status === 200, `status ${login.status} ${login.text.slice(0, 160)}`)

  // --- baseline: environment configuration is used --------------------------
  const first = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: 'sovereign', sentence: 'The sovereign ruled.' }) })
  check('definition succeeds using env config', first.status === 200 && first.json?.definition?.meaningZh === '来自环境变量的释义', `${first.status} ${first.text.slice(0, 200)}`)
  check('env endpoint received the request', envAi.requests.length === 1 && envAi.requests[0].url === '/v1/responses')
  check('env endpoint got the env key', envAi.requests[0]?.authorization === 'Bearer env-key-should-not-leak')

  const servicesBefore = await api('/api/ai/services')
  check('services payload reports env as the config source', servicesBefore.json?.customConfig?.text?.effective?.source === 'env')
  check('services payload exposes no stored key', servicesBefore.json?.customConfig?.text?.hasCustomKey === false)

  // --- switch to a custom endpoint from the web, with no restart ------------
  const patch = await api('/api/ai/services/config', {
    method: 'PATCH',
    body: JSON.stringify({ text: { baseUrl: customAi.baseUrl.replace(/\/v1$/, ''), apiKey: 'custom-key-should-not-leak', model: 'custom-model' } }),
  })
  check('config PATCH succeeds', patch.status === 200, `${patch.status} ${patch.text.slice(0, 200)}`)
  check('config PATCH reports custom source', patch.json?.customConfig?.text?.effective?.source === 'custom')
  check('config PATCH masks the key', /^cus••••leak$/.test(patch.json?.customConfig?.text?.apiKeyMask || ''), patch.json?.customConfig?.text?.apiKeyMask)
  check('config PATCH never echoes the raw key', !patch.text.includes('custom-key-should-not-leak'))
  check('base URL is normalized to /v1', patch.json?.customConfig?.text?.effective?.baseUrl === customAi.baseUrl)

  const second = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: 'sovereign', sentence: 'A different sentence entirely.' }) })
  check('definition now uses the custom endpoint', second.status === 200 && second.json?.definition?.meaningZh === '来自自定义端点的释义', `${second.status} ${second.text.slice(0, 200)}`)
  check('custom endpoint received the request without a restart', customAi.requests.length > 0)
  check('custom endpoint got the custom key', customAi.requests.at(-1)?.authorization === 'Bearer custom-key-should-not-leak')
  check('env endpoint saw no further traffic', envAi.requests.length === 1)
  check('custom model reached the upstream', customAi.requests.at(-1)?.body?.model === 'custom-model')

  // The fake relay rejects json_schema and has no /responses route, so a
  // successful call proves both fallbacks fired.
  const attemptedResponses = customAi.requests.some((item) => item.url === '/v1/responses')
  const attemptedSchema = customAi.requests.some((item) => item.body?.response_format?.type === 'json_schema')
  const relaxedSchema = customAi.requests.some(
    (item) => item.url === '/v1/chat/completions' && item.body?.response_format?.type !== 'json_schema',
  )
  check('probed the Responses API before falling back', attemptedResponses)
  check('tried json_schema before relaxing it', attemptedSchema)
  check('relaxed structured output after the endpoint rejected json_schema', relaxedSchema)
  check('the relaxed request inlines the JSON schema in the prompt', customAi.requests.at(-1)?.body?.messages?.at(-1)?.content?.includes('JSON Schema'))

  const probeCountBefore = customAi.requests.filter((item) => item.url === '/v1/responses').length
  const third = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: 'dominion', sentence: 'Another sentence.' }) })
  check('a later call still succeeds', third.status === 200 && third.json?.definition?.meaningZh === '来自自定义端点的释义')
  check(
    'the dead Responses route is not probed again',
    customAi.requests.filter((item) => item.url === '/v1/responses').length === probeCountBefore,
  )

  // --- connection test reflects the custom endpoint -------------------------
  const test = await api('/api/ai/services/text-ai/test', { method: 'POST' })
  check('service test passes against the custom endpoint', test.status === 200, `${test.status} ${test.text.slice(0, 200)}`)
  check('service test never echoes a key', !test.text.includes('custom-key-should-not-leak') && !test.text.includes('env-key-should-not-leak'))

  // --- partial update keeps the stored key ---------------------------------
  const modelOnly = await api('/api/ai/services/config', { method: 'PATCH', body: JSON.stringify({ text: { model: 'another-model' } }) })
  check('updating only the model keeps the stored key', modelOnly.json?.customConfig?.text?.hasCustomKey === true)
  check('updating only the model keeps the custom base URL', modelOnly.json?.customConfig?.text?.effective?.baseUrl === customAi.baseUrl)

  // --- clearing the key falls back to the environment ----------------------
  const cleared = await api('/api/ai/services/config', { method: 'PATCH', body: JSON.stringify({ text: { apiKey: null, baseUrl: '', model: '' } }) })
  check('clearing custom fields restores the env source', cleared.json?.customConfig?.text?.effective?.source === 'env')
  check('clearing custom fields restores the env base URL', cleared.json?.customConfig?.text?.effective?.baseUrl === envAi.baseUrl)

  const envRequestsBefore = envAi.requests.length
  const fourth = await api('/api/words/define', { method: 'POST', body: JSON.stringify({ term: 'realm', sentence: 'Yet another sentence.' }) })
  check('traffic returns to the env endpoint after clearing', fourth.status === 200 && envAi.requests.length === envRequestsBefore + 1)

  // --- podcast TTS: config reaches the real HTTP call -----------------------
  const qwenEnvTest = await api('/api/ai/services/podcast-tts-qwen/test', { method: 'POST' })
  check('podcast TTS test passes with env config', qwenEnvTest.status === 200, `${qwenEnvTest.status} ${qwenEnvTest.text.slice(0, 200)}`)
  check('env DashScope endpoint was called', envDashscope.requests.length === 1)
  check('env DashScope model reached upstream', envDashscope.requests[0]?.body?.model === 'env-qwen-model')

  const qwenPatch = await api('/api/ai/services/config', {
    method: 'PATCH',
    body: JSON.stringify({
      podcastQwen: { baseUrl: customDashscope.baseUrl, apiKey: 'custom-dashscope-key-should-not-leak', model: 'custom-qwen-model' },
    }),
  })
  check('podcast TTS config PATCH succeeds', qwenPatch.status === 200, `${qwenPatch.status} ${qwenPatch.text.slice(0, 200)}`)
  check('podcast TTS base URL is kept verbatim (no /v1 coercion)', qwenPatch.json?.customConfig?.podcastQwen?.effective?.baseUrl === customDashscope.baseUrl)
  check('podcast TTS key is masked', qwenPatch.json?.customConfig?.podcastQwen?.hasCustomKey === true)
  check('podcast TTS PATCH never echoes the raw key', !qwenPatch.text.includes('custom-dashscope-key-should-not-leak'))

  const qwenCustomTest = await api('/api/ai/services/podcast-tts-qwen/test', { method: 'POST' })
  check('podcast TTS test passes against the custom endpoint', qwenCustomTest.status === 200, `${qwenCustomTest.status} ${qwenCustomTest.text.slice(0, 200)}`)
  check('custom DashScope endpoint received the request', customDashscope.requests.length === 1)
  check('custom DashScope key reached upstream', customDashscope.requests[0]?.authorization === 'Bearer custom-dashscope-key-should-not-leak')
  check('custom DashScope model reached upstream', customDashscope.requests[0]?.body?.model === 'custom-qwen-model')
  check('env DashScope saw no further traffic', envDashscope.requests.length === 1)

  // --- OCR ------------------------------------------------------------------
  const ocrBefore = await api('/api/ai/services')
  check('OCR reports the env model before any change', ocrBefore.json?.customConfig?.ocr?.effective?.model === 'env-ocr-model')
  const ocrCard = (ocrBefore.json?.services || []).find((service) => service.id === 'vision-ocr')
  check('OCR service card uses the env model', ocrCard?.model === 'env-ocr-model')

  const ocrPatch = await api('/api/ai/services/config', {
    method: 'PATCH',
    body: JSON.stringify({ ocr: { baseUrl: 'https://custom-ocr.test', apiKey: 'custom-ocr-key-should-not-leak', model: 'custom-ocr-model' } }),
  })
  check('OCR config PATCH succeeds', ocrPatch.status === 200, `${ocrPatch.status} ${ocrPatch.text.slice(0, 200)}`)
  check('OCR base URL is normalized to /v1', ocrPatch.json?.customConfig?.ocr?.effective?.baseUrl === 'https://custom-ocr.test/v1')
  check('OCR PATCH never echoes the raw key', !ocrPatch.text.includes('custom-ocr-key-should-not-leak'))
  const ocrCardAfter = (ocrPatch.json?.services || []).find((service) => service.id === 'vision-ocr')
  check('OCR service card follows the custom model without a restart', ocrCardAfter?.model === 'custom-ocr-model')
  check('OCR service card follows the custom endpoint', ocrCardAfter?.endpointHost === 'custom-ocr.test')

  // --- listening TTS --------------------------------------------------------
  const listeningPatch = await api('/api/ai/services/config', {
    method: 'PATCH',
    body: JSON.stringify({ listeningTts: { model: 'custom-listening-model', voice: 'nova', provider: 'openai-speech' } }),
  })
  const listeningCard = (listeningPatch.json?.services || []).find((service) => service.id === 'listening-tts')
  check('listening TTS card follows the custom model', listeningCard?.model === 'custom-listening-model')
  check('listening TTS card shows the custom voice', (listeningCard?.details || []).some((detail) => detail.includes('nova')))
  check(
    'listening TTS still inherits the text API key when none is set',
    listeningPatch.json?.customConfig?.listeningTts?.effective?.configured === true,
  )

  // --- no capability leaks a secret anywhere in the admin payload ----------
  const finalPayload = await api('/api/ai/services')
  const leaked = ['custom-key-should-not-leak', 'env-key-should-not-leak', 'custom-dashscope-key-should-not-leak', 'env-dashscope-key-should-not-leak', 'custom-ocr-key-should-not-leak', 'env-ocr-key-should-not-leak']
    .filter((secret) => finalPayload.text.includes(secret))
  check('the full services payload leaks no API key', leaked.length === 0, `leaked: ${leaked.join(', ')}`)

  // --- non-admins cannot read or write the configuration -------------------
  const adminCookie = cookie
  cookie = ''
  const anon = await api('/api/ai/services/config', { method: 'PATCH', body: JSON.stringify({ text: { model: 'x' } }) })
  check('unauthenticated config write is rejected', anon.status === 401 || anon.status === 403, `status ${anon.status}`)
  cookie = adminCookie

  const emptyPatch = await api('/api/ai/services/config', { method: 'PATCH', body: JSON.stringify({ nonsense: true }) })
  check('a patch with no known capability is rejected', emptyPatch.status === 400, `status ${emptyPatch.status}`)
} catch (error) {
  failed += 1
  console.error(`FAIL  harness error: ${error.message}`)
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined)
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
