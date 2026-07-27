// Unit tests for the customizable AI service configuration layer.
// Run with: node scripts/test-ai-config.mjs
import assert from 'node:assert/strict'
import {
  normalizeBaseUrl,
  maskSecret,
  normalizeTextConfig,
  normalizeServiceConfig,
  resolveTextConfig,
  publicTextConfig,
  parseJsonLoose,
  extractChatText,
  extractResponsesText,
  requestTextAi,
  resetEndpointCapabilities,
} from '../server/ai-config.js'

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}`)
    console.error(`      ${error.message}`)
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }
}

function errorResponse(status, body) {
  return { ok: false, status, json: async () => ({}), text: async () => body }
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] }
const CONFIG = { baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', apiStyle: 'auto', jsonMode: 'auto', reasoningEffort: 'medium', verbosity: 'medium' }

console.log('AI config unit tests')

await test('normalizeBaseUrl appends /v1 and preserves explicit versions', () => {
  assert.equal(normalizeBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1')
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1')
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.equal(normalizeBaseUrl('https://gw.test/openai/v1beta'), 'https://gw.test/openai/v1beta')
  assert.equal(normalizeBaseUrl(''), '')
})

await test('maskSecret never reveals the middle of a key', () => {
  assert.equal(maskSecret(''), '')
  assert.equal(maskSecret('short'), '••••')
  const masked = maskSecret('sk-abcdefghijklmnop')
  assert.equal(masked, 'sk-••••mnop')
  assert.ok(!masked.includes('defghij'))
})

await test('normalizeTextConfig rejects unknown enum values', () => {
  const config = normalizeTextConfig({ apiStyle: 'telepathy', jsonMode: 'xml', reasoningEffort: 'extreme', verbosity: 'loud' })
  assert.equal(config.apiStyle, 'auto')
  assert.equal(config.jsonMode, 'auto')
  assert.equal(config.reasoningEffort, '')
  assert.equal(config.verbosity, '')
})

await test('normalizeTextConfig emits only the fields that were submitted', () => {
  assert.deepEqual(normalizeTextConfig({ model: 'm' }), { model: 'm' })
  assert.deepEqual(normalizeTextConfig({}), {})
  assert.deepEqual(Object.keys(normalizeTextConfig({ baseUrl: 'https://a.test', apiKey: 'k' })).sort(), ['apiKey', 'baseUrl'])
  assert.deepEqual(normalizeTextConfig({ baseUrl: '' }), { baseUrl: '' }, 'an explicit empty value must survive as a clear instruction')
})

await test('normalizeTextConfig keeps a submitted key and clears an explicit null', () => {
  assert.equal(normalizeTextConfig({ apiKey: '  sk-live  ' }).apiKey, 'sk-live')
  assert.equal(normalizeTextConfig({ apiKey: null }).apiKey, '')
  assert.equal('apiKey' in normalizeTextConfig({}), false, 'omitting apiKey must leave the stored key untouched')
})

await test('normalizeServiceConfig drops unknown capabilities', () => {
  const config = normalizeServiceConfig({ text: { model: 'gpt' }, nonsense: { model: 'x' } })
  assert.deepEqual(Object.keys(config), ['text'])
})

await test('resolveTextConfig prefers stored config over env, env over defaults', () => {
  const env = { OPENAI_BASE_URL: 'https://env.test/v1', OPENAI_API_KEY: 'env-key', OPENAI_MODEL: 'env-model' }
  const fromEnv = resolveTextConfig({}, env)
  assert.equal(fromEnv.baseUrl, 'https://env.test/v1')
  assert.equal(fromEnv.model, 'env-model')
  assert.equal(fromEnv.source, 'env')

  const stored = { text: { baseUrl: 'https://stored.test/v1', apiKey: 'stored-key', model: 'stored-model' } }
  const merged = resolveTextConfig(stored, env)
  assert.equal(merged.baseUrl, 'https://stored.test/v1')
  assert.equal(merged.apiKey, 'stored-key')
  assert.equal(merged.model, 'stored-model')
  assert.equal(merged.source, 'custom')

  const bare = resolveTextConfig({}, {})
  assert.equal(bare.baseUrl, 'https://api.openai.com/v1')
  assert.equal(bare.apiKey, '')
})

await test('resolveTextConfig falls back per field, not all-or-nothing', () => {
  const merged = resolveTextConfig({ text: { model: 'only-model' } }, { OPENAI_API_KEY: 'env-key', OPENAI_BASE_URL: 'https://env.test' })
  assert.equal(merged.model, 'only-model')
  assert.equal(merged.apiKey, 'env-key')
  assert.equal(merged.baseUrl, 'https://env.test/v1')
})

await test('publicTextConfig never exposes the raw key', () => {
  const stored = { text: { apiKey: 'sk-supersecretvalue', model: 'm' } }
  const payload = publicTextConfig(stored, resolveTextConfig(stored, {}))
  const serialized = JSON.stringify(payload)
  assert.ok(!serialized.includes('supersecret'), 'raw key leaked into admin payload')
  assert.equal(payload.hasCustomKey, true)
  assert.ok(payload.apiKeyMask.startsWith('sk-'))
})

await test('parseJsonLoose survives fences and surrounding prose', () => {
  assert.deepEqual(parseJsonLoose('{"ok":"yes"}'), { ok: 'yes' })
  assert.deepEqual(parseJsonLoose('```json\n{"ok":"yes"}\n```'), { ok: 'yes' })
  assert.deepEqual(parseJsonLoose('Sure!\n{"ok":"yes"}\nHope that helps.'), { ok: 'yes' })
  assert.throws(() => parseJsonLoose(''), /未返回内容/)
  assert.throws(() => parseJsonLoose('no json here'), /不是有效 JSON/)
})

await test('extractors read both dialects', () => {
  assert.equal(extractResponsesText({ output_text: 'hi' }), 'hi')
  assert.equal(extractResponsesText({ output: [{ type: 'message', content: [{ text: 'a' }, { text: 'b' }] }] }), 'ab')
  assert.equal(extractChatText({ choices: [{ message: { content: ' hi ' } }] }), 'hi')
  assert.equal(extractChatText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab')
})

await test('requestTextAi uses the Responses API when it works', async () => {
  resetEndpointCapabilities()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return jsonResponse({ output_text: '{"ok":"yes"}' })
  }
  const result = await requestTextAi(CONFIG, { instructions: 'i', input: 'p', schema: SCHEMA, schemaName: 'thing' }, { fetchImpl })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/responses'))
  assert.equal(calls[0].body.text.format.type, 'json_schema')
  assert.equal(calls[0].body.reasoning.effort, 'medium')
  assert.deepEqual(parseJsonLoose(result.text), { ok: 'yes' })
})

await test('requestTextAi falls back to chat completions on 404', async () => {
  resetEndpointCapabilities()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    if (url.endsWith('/responses')) return errorResponse(404, 'Unknown path /v1/responses')
    return jsonResponse({ choices: [{ message: { content: '{"ok":"yes"}' } }] })
  }
  const result = await requestTextAi(CONFIG, { instructions: 'i', input: 'p', schema: SCHEMA }, { fetchImpl })
  assert.equal(calls.length, 2)
  assert.ok(calls[1].url.endsWith('/chat/completions'))
  assert.equal(calls[1].body.messages[0].role, 'system')
  assert.equal(calls[1].body.response_format.type, 'json_schema')
  assert.equal(result.apiStyle, 'chat')
})

await test('requestTextAi remembers the working dialect per endpoint', async () => {
  resetEndpointCapabilities()
  let responsesAttempts = 0
  const fetchImpl = async (url) => {
    if (url.endsWith('/responses')) {
      responsesAttempts += 1
      return errorResponse(404, 'not found')
    }
    return jsonResponse({ choices: [{ message: { content: '{"ok":"yes"}' } }] })
  }
  await requestTextAi(CONFIG, { input: 'p', schema: SCHEMA }, { fetchImpl })
  await requestTextAi(CONFIG, { input: 'p', schema: SCHEMA }, { fetchImpl })
  assert.equal(responsesAttempts, 1, 'the dead endpoint should be probed only once per process')
})

await test('requestTextAi degrades json_schema to json_object then to prompted schema', async () => {
  resetEndpointCapabilities()
  const modes = []
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    const mode = body.response_format?.type || body.text?.format?.type || 'none'
    modes.push(mode)
    if (mode === 'json_schema') return errorResponse(400, 'response_format json_schema is not supported')
    if (mode === 'json_object') return errorResponse(400, 'Unsupported parameter: response_format')
    return jsonResponse({ choices: [{ message: { content: '```json\n{"ok":"yes"}\n```' } }] })
  }
  const config = { ...CONFIG, apiStyle: 'chat' }
  const result = await requestTextAi(config, { input: 'p', schema: SCHEMA, schemaName: 'thing' }, { fetchImpl })
  assert.deepEqual(modes, ['json_schema', 'json_object', 'none'])
  assert.equal(result.jsonMode, 'prompt')
  assert.deepEqual(parseJsonLoose(result.text), { ok: 'yes' })
})

await test('requestTextAi inlines the schema in the prompt when structured output is unavailable', async () => {
  resetEndpointCapabilities()
  let lastInput = ''
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    lastInput = body.messages[body.messages.length - 1].content
    if (body.response_format) return errorResponse(400, 'json_schema unsupported')
    return jsonResponse({ choices: [{ message: { content: '{"ok":"yes"}' } }] })
  }
  await requestTextAi({ ...CONFIG, apiStyle: 'chat', jsonMode: 'prompt' }, { input: 'PROMPT', schema: SCHEMA, schemaName: 'thing' }, { fetchImpl })
  assert.ok(lastInput.startsWith('PROMPT'))
  assert.ok(lastInput.includes('"thing"'), 'schema name should reach the prompt')
  assert.ok(lastInput.includes('JSON Schema'))
})

await test('requestTextAi retries without reasoning/verbosity when rejected', async () => {
  resetEndpointCapabilities()
  const bodies = []
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    if (body.reasoning) return errorResponse(400, 'Unrecognized request argument supplied: reasoning')
    return jsonResponse({ output_text: '{"ok":"yes"}' })
  }
  await requestTextAi({ ...CONFIG, apiStyle: 'responses' }, { input: 'p', schema: SCHEMA }, { fetchImpl })
  assert.equal(bodies.length, 2)
  assert.ok(bodies[0].reasoning)
  assert.equal(bodies[1].reasoning, undefined)
  assert.equal(bodies[1].text?.verbosity, undefined)
})

await test('requestTextAi surfaces auth failures immediately without probing', async () => {
  resetEndpointCapabilities()
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    return errorResponse(401, 'Incorrect API key provided')
  }
  await assert.rejects(
    () => requestTextAi(CONFIG, { input: 'p', schema: SCHEMA }, { fetchImpl, errorLabel: '文本服务' }),
    /文本服务返回错误：401/,
  )
  assert.equal(attempts, 1, 'a 401 must not trigger dialect probing')
})

await test('requestTextAi honours an explicitly pinned dialect', async () => {
  resetEndpointCapabilities()
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    return jsonResponse({ choices: [{ message: { content: '{"ok":"yes"}' } }] })
  }
  await requestTextAi({ ...CONFIG, apiStyle: 'chat', jsonMode: 'schema' }, { input: 'p', schema: SCHEMA }, { fetchImpl })
  assert.equal(urls.length, 1)
  assert.ok(urls[0].endsWith('/chat/completions'))
})

await test('requestTextAi works without a schema (plain text probe)', async () => {
  resetEndpointCapabilities()
  const fetchImpl = async () => jsonResponse({ output_text: 'OK' })
  const result = await requestTextAi(CONFIG, { input: 'Return only the word OK.', maxOutputTokens: 16 }, { fetchImpl })
  assert.equal(result.text, 'OK')
})

await test('requestTextAi propagates network/timeout errors untouched', async () => {
  resetEndpointCapabilities()
  const fetchImpl = async () => {
    const error = new Error('AI 文本服务请求超时（60 秒）')
    error.code = 'UPSTREAM_TIMEOUT'
    throw error
  }
  await assert.rejects(() => requestTextAi(CONFIG, { input: 'p' }, { fetchImpl }), (error) => error.code === 'UPSTREAM_TIMEOUT')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
