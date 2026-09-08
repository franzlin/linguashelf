// Shared configuration + request helpers for user-customizable AI services.
//
// Design notes:
// - Every capability (text / listening TTS / podcast TTS / OCR) resolves its
//   settings from three layers, highest priority first:
//     1. stored config (SQLite `appSettings`, editable from the admin web UI)
//     2. process environment (`.env`, the historical source of truth)
//     3. built-in defaults
// - Secrets never leave the server: `publicCapabilityConfig` masks them and the
//   admin API only ever accepts writes.
// - Third-party "OpenAI compatible" endpoints vary a lot. `requestTextAi`
//   therefore speaks both the Responses API and Chat Completions, and can
//   downgrade structured-output mode when an endpoint rejects json_schema.

export const TEXT_API_STYLES = ['auto', 'responses', 'chat']
export const TEXT_JSON_MODES = ['auto', 'schema', 'object', 'prompt']
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high']

const DEFAULT_TEXT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TEXT_MODEL = 'gpt-5.5'

export function trimString(value, max = 400) {
  return String(value ?? '').trim().slice(0, max)
}

// Normalizes a base URL to the `.../v1` form most OpenAI-compatible services use.
// A URL already ending in a version segment (v1, v1beta, v2 …) is left alone so
// self-hosted gateways with custom prefixes keep working.
export function normalizeBaseUrl(value) {
  const base = trimString(value, 400).replace(/\/+$/, '')
  if (!base) return ''
  if (/\/v\d+[a-z0-9-]*$/i.test(base)) return base
  return `${base}/v1`
}

export function maskSecret(value) {
  const secret = String(value ?? '')
  if (!secret) return ''
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 3)}••••${secret.slice(-4)}`
}

function pickEnum(value, allowed, fallback) {
  const candidate = trimString(value, 40).toLowerCase()
  return allowed.includes(candidate) ? candidate : fallback
}

// --- Capability field schemas -------------------------------------------
//
// Every customizable capability declares its fields once. Normalization,
// masking and the admin payload are all derived from these declarations so a
// new provider only needs an entry here.

const URL_RAW = 'url-raw'
const URL_OPENAI = 'url-openai'
const TEXT = 'text'
const SECRET = 'secret'
const LONG_TEXT = 'long-text'

export const CAPABILITY_FIELDS = {
  text: {
    baseUrl: { kind: URL_OPENAI },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
    apiStyle: { kind: 'enum', values: TEXT_API_STYLES, fallback: 'auto' },
    jsonMode: { kind: 'enum', values: TEXT_JSON_MODES, fallback: 'auto' },
    reasoningEffort: { kind: 'enum', values: REASONING_EFFORTS, fallback: '' },
    verbosity: { kind: 'enum', values: ['low', 'medium', 'high'], fallback: '' },
  },
  listeningTts: {
    baseUrl: { kind: URL_OPENAI },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
    provider: { kind: 'enum', values: ['openai-speech', 'mimo'], fallback: '' },
    voice: { kind: TEXT },
    instructions: { kind: LONG_TEXT },
  },
  // DashScope and Gemini use their own URL shapes, so their base URLs are kept
  // verbatim rather than coerced to an OpenAI-style /v1 suffix.
  podcastQwen: {
    baseUrl: { kind: URL_RAW },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
    voice: { kind: TEXT },
  },
  podcastGeminiOfficial: {
    baseUrl: { kind: URL_RAW },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
  },
  podcastGeminiFallback: {
    baseUrl: { kind: URL_RAW },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
  },
  ocr: {
    baseUrl: { kind: URL_OPENAI },
    apiKey: { kind: SECRET },
    model: { kind: TEXT },
  },
}

export const CAPABILITY_IDS = Object.keys(CAPABILITY_FIELDS)

function normalizeField(spec, value) {
  switch (spec.kind) {
    case URL_OPENAI:
      return normalizeBaseUrl(value)
    case URL_RAW:
      return trimString(value, 400).replace(/\/+$/, '')
    case SECRET:
      return typeof value === 'string' ? value.trim().slice(0, 400) : ''
    case LONG_TEXT:
      return trimString(value, 1200)
    case 'enum':
      return pickEnum(value, spec.values, spec.fallback)
    default:
      return trimString(value, 200)
  }
}

// Normalizes one capability's stored config.
//
// Only fields actually present in the input are emitted, so a partial update
// from the admin UI leaves everything else alone. An explicitly submitted empty
// string (or null) means "clear this field and fall back to the environment".
export function normalizeCapabilityConfig(capability, value = {}) {
  const fields = CAPABILITY_FIELDS[capability]
  if (!fields || !value || typeof value !== 'object') return {}
  const config = {}
  for (const [field, spec] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, field) || value[field] === undefined) continue
    config[field] = normalizeField(spec, value[field])
  }
  return config
}

export function normalizeTextConfig(value = {}) {
  return normalizeCapabilityConfig('text', value)
}

export function normalizeServiceConfig(value = {}) {
  const next = {}
  if (!value || typeof value !== 'object') return next
  for (const capability of CAPABILITY_IDS) {
    if (!value[capability] || typeof value[capability] !== 'object') continue
    const normalized = normalizeCapabilityConfig(capability, value[capability])
    if (Object.keys(normalized).length) next[capability] = normalized
  }
  return next
}

// Merge stored config over environment defaults for the text capability.
export function resolveTextConfig(stored = {}, env = process.env) {
  const saved = stored?.text || {}
  const baseUrl = saved.baseUrl || normalizeBaseUrl(env.OPENAI_BASE_URL) || DEFAULT_TEXT_BASE_URL
  return {
    baseUrl,
    apiKey: saved.apiKey || String(env.OPENAI_API_KEY || ''),
    model: saved.model || String(env.OPENAI_MODEL || DEFAULT_TEXT_MODEL),
    apiStyle: saved.apiStyle || pickEnum(env.OPENAI_API_STYLE, TEXT_API_STYLES, 'auto'),
    jsonMode: saved.jsonMode || pickEnum(env.OPENAI_JSON_MODE, TEXT_JSON_MODES, 'auto'),
    reasoningEffort: saved.reasoningEffort || pickEnum(env.OPENAI_REASONING_EFFORT, REASONING_EFFORTS, 'medium'),
    verbosity: saved.verbosity || pickEnum(env.OPENAI_VERBOSITY, ['low', 'medium', 'high'], 'medium'),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

// Listening warm-up TTS. Historically fell back to the text service credentials.
export function resolveListeningTtsConfig(stored = {}, env = process.env) {
  const saved = stored?.listeningTts || {}
  return {
    baseUrl:
      saved.baseUrl ||
      normalizeBaseUrl(env.OPENAI_TTS_BASE_URL) ||
      normalizeBaseUrl(env.OPENAI_BASE_URL) ||
      DEFAULT_TEXT_BASE_URL,
    apiKey: saved.apiKey || String(env.OPENAI_TTS_API_KEY || env.OPENAI_API_KEY || ''),
    model: saved.model || String(env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'),
    provider: saved.provider || String(env.OPENAI_TTS_PROVIDER || 'openai-speech'),
    voice: saved.voice || String(env.OPENAI_TTS_VOICES || env.OPENAI_TTS_VOICE || ''),
    instructions: saved.instructions || String(env.OPENAI_TTS_INSTRUCTIONS || ''),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

export function resolvePodcastQwenConfig(stored = {}, env = process.env) {
  const saved = stored?.podcastQwen || {}
  const apiKey = saved.apiKey || String(env.DASHSCOPE_TTS_API_KEY || '').trim()
  return {
    baseUrl: saved.baseUrl || String(env.DASHSCOPE_TTS_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1'),
    apiKey,
    model: saved.model || String(env.DASHSCOPE_TTS_MODEL || 'qwen-audio-3.0-tts-plus'),
    voice: saved.voice || String(env.DASHSCOPE_TTS_VOICE || ''),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

export function resolvePodcastGeminiOfficialConfig(stored = {}, env = process.env) {
  const saved = stored?.podcastGeminiOfficial || {}
  return {
    baseUrl: saved.baseUrl || String(env.GEMINI_TTS_OFFICIAL_BASE_URL || 'https://generativelanguage.googleapis.com'),
    apiKey: saved.apiKey || String(env.GEMINI_TTS_OFFICIAL_API_KEY || ''),
    model: saved.model || String(env.GEMINI_TTS_OFFICIAL_MODEL || 'gemini-3.1-flash-tts-preview'),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

export function resolvePodcastGeminiFallbackConfig(stored = {}, env = process.env) {
  const saved = stored?.podcastGeminiFallback || {}
  return {
    baseUrl: saved.baseUrl || String(env.GEMINI_TTS_BASE_URL || 'https://api.futureppo.top'),
    apiKey: saved.apiKey || String(env.GEMINI_TTS_API_KEY || '').trim(),
    model: saved.model || String(env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

// Vision OCR for scanned PDFs. Local Tesseract remains the fallback and is not
// configurable from the web.
export function resolveOcrConfig(stored = {}, env = process.env) {
  const saved = stored?.ocr || {}
  return {
    baseUrl: saved.baseUrl || normalizeBaseUrl(env.PDF_OCR_VISION_BASE_URL || env.GEMINI_TTS_BASE_URL || ''),
    apiKey: saved.apiKey || String(env.PDF_OCR_VISION_API_KEY || env.GEMINI_TTS_API_KEY || ''),
    model: saved.model || String(env.PDF_OCR_VISION_MODEL || 'hunyuan-ocr'),
    source: saved.baseUrl || saved.apiKey || saved.model ? 'custom' : 'env',
  }
}

export const CAPABILITY_RESOLVERS = {
  text: resolveTextConfig,
  listeningTts: resolveListeningTtsConfig,
  podcastQwen: resolvePodcastQwenConfig,
  podcastGeminiOfficial: resolvePodcastGeminiOfficialConfig,
  podcastGeminiFallback: resolvePodcastGeminiFallbackConfig,
  ocr: resolveOcrConfig,
}

// Admin-facing view of one capability: what the user typed (key masked) plus
// what the server will actually use.
export function publicCapabilityConfig(capability, stored = {}, resolved = {}) {
  const fields = CAPABILITY_FIELDS[capability] || {}
  const saved = stored?.[capability] || {}
  const custom = {}
  const effective = {}
  for (const field of Object.keys(fields)) {
    if (field === 'apiKey') continue
    custom[field] = saved[field] ?? ''
    effective[field] = resolved[field] ?? ''
  }
  return {
    ...custom,
    apiKeyMask: maskSecret(saved.apiKey),
    hasCustomKey: Boolean(saved.apiKey),
    effective: {
      ...effective,
      configured: Boolean(resolved.apiKey),
      source: resolved.source || 'env',
    },
  }
}

export function publicTextConfig(stored = {}, resolved = {}) {
  return publicCapabilityConfig('text', stored, resolved)
}

// The whole customizable configuration, safe to send to an admin client.
export function publicServiceConfig(stored = {}, env = process.env) {
  const payload = {}
  for (const capability of CAPABILITY_IDS) {
    payload[capability] = publicCapabilityConfig(capability, stored, CAPABILITY_RESOLVERS[capability](stored, env))
  }
  return payload
}

// Remembers, per endpoint, which dialect actually worked so the probe cost is
// paid once per process rather than on every request.
const endpointCapabilities = new Map()

function capabilityKey(config) {
  return `${config.baseUrl}::${config.model}`
}

export function getEndpointCapability(config) {
  return endpointCapabilities.get(capabilityKey(config)) || {}
}

function rememberCapability(config, patch) {
  const key = capabilityKey(config)
  endpointCapabilities.set(key, { ...(endpointCapabilities.get(key) || {}), ...patch })
}

export function resetEndpointCapabilities() {
  endpointCapabilities.clear()
}

function schemaInstructionSuffix(schema, schemaName) {
  if (!schema) return ''
  return `\n\nReturn a single JSON object only, with no markdown fence and no commentary. It must validate against this JSON Schema named "${schemaName || 'response'}":\n${JSON.stringify(schema)}`
}

function buildResponsesBody({ config, instructions, input, schema, schemaName, maxOutputTokens, jsonMode, reasoningEffort, verbosity }) {
  const body = {
    model: config.model,
    store: false,
    instructions,
    input,
  }
  if (reasoningEffort && reasoningEffort !== 'none') body.reasoning = { effort: reasoningEffort }
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens

  const text = {}
  if (verbosity) text.verbosity = verbosity
  if (schema && jsonMode === 'schema') {
    text.format = { type: 'json_schema', name: schemaName || 'response', strict: true, schema }
  } else if (schema && jsonMode === 'object') {
    text.format = { type: 'json_object' }
  }
  if (Object.keys(text).length) body.text = text
  return body
}

function buildChatBody({ config, instructions, input, schema, schemaName, maxOutputTokens, jsonMode, reasoningEffort }) {
  const body = {
    model: config.model,
    messages: [
      ...(instructions ? [{ role: 'system', content: instructions }] : []),
      { role: 'user', content: input },
    ],
  }
  if (maxOutputTokens) body.max_completion_tokens = maxOutputTokens
  if (reasoningEffort && reasoningEffort !== 'none') body.reasoning_effort = reasoningEffort
  if (schema && jsonMode === 'schema') {
    body.response_format = { type: 'json_schema', json_schema: { name: schemaName || 'response', strict: true, schema } }
  } else if (schema && jsonMode === 'object') {
    body.response_format = { type: 'json_object' }
  }
  return body
}

export function extractResponsesText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text
  const chunks = []
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text)
      if (typeof content?.content === 'string') chunks.push(content.content)
    }
  }
  return chunks.join('').trim()
}

export function extractChatText(payload) {
  const message = payload?.choices?.[0]?.message
  if (!message) return ''
  if (typeof message.content === 'string') return message.content.trim()
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }
  return ''
}

// Strips markdown fences and leading prose some endpoints add before the JSON.
export function parseJsonLoose(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('AI 服务未返回内容')
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(unfenced)
  } catch {
    const start = unfenced.indexOf('{')
    const end = unfenced.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1))
    throw new Error('AI 服务返回的内容不是有效 JSON')
  }
}

// Deliberately narrow: a generic "not supported" usually means a rejected
// parameter, not a missing route, and must not trigger a dialect switch.
function looksLikeMissingEndpoint(status, body) {
  if (status === 404 || status === 405) return true
  const text = String(body || '').toLowerCase()
  return status === 400 && /unknown (url|path|endpoint)|no such (url|path|endpoint)|(endpoint|path|route) not found|invalid url/.test(text)
}

// Both checks key off the field name the endpoint complained about. Generic
// phrases like "unsupported parameter" are intentionally excluded because they
// appear in every kind of rejection and would make the two indistinguishable.
function looksLikeSchemaRejection(status, body) {
  if (status !== 400 && status !== 422) return false
  const text = String(body || '').toLowerCase()
  if (/reasoning|verbosity/.test(text)) return false
  return /json_schema|json_object|response_format|text\.format|structured output|schema/.test(text)
}

function looksLikeReasoningRejection(status, body) {
  if (status !== 400 && status !== 422) return false
  const text = String(body || '').toLowerCase()
  return /reasoning|verbosity/.test(text)
}

/**
 * Calls the configured text model and returns its raw text output.
 *
 * Tries the configured dialect first, then degrades in a fixed order so a
 * minimal OpenAI-compatible endpoint still works:
 *   Responses API → Chat Completions
 *   json_schema   → json_object → schema-in-prompt
 *   reasoning/verbosity fields → omitted
 * Whatever combination succeeds is cached per endpoint for the process lifetime.
 */
export async function requestTextAi(config, request, deps) {
  const { fetchImpl, errorLabel = 'AI 服务' } = deps
  const learned = getEndpointCapability(config)
  const schema = request.schema || null
  const schemaName = request.schemaName || 'response'

  const styleOrder =
    config.apiStyle === 'responses' || config.apiStyle === 'chat'
      ? [config.apiStyle]
      : learned.apiStyle
        ? [learned.apiStyle]
        : ['responses', 'chat']

  const configuredJsonMode = config.jsonMode && config.jsonMode !== 'auto' ? config.jsonMode : ''
  const jsonOrder = !schema
    ? ['none']
    : configuredJsonMode
      ? [configuredJsonMode]
      : learned.jsonMode
        ? [learned.jsonMode]
        : ['schema', 'object', 'prompt']

  const extrasOrder = learned.dropExtras ? [false] : [true, false]

  let lastError = null

  for (const apiStyle of styleOrder) {
    let styleUnsupported = false

    for (const jsonMode of jsonOrder) {
      for (const withExtras of extrasOrder) {
        const needsPromptedSchema = schema && (jsonMode === 'prompt' || jsonMode === 'object')
        const input = needsPromptedSchema ? `${request.input}${schemaInstructionSuffix(schema, schemaName)}` : request.input
        const shared = {
          config,
          instructions: request.instructions,
          input,
          schema,
          schemaName,
          maxOutputTokens: request.maxOutputTokens,
          jsonMode,
          reasoningEffort: withExtras ? (request.reasoningEffort ?? config.reasoningEffort) : '',
          verbosity: withExtras ? (request.verbosity ?? config.verbosity) : '',
        }
        const url = apiStyle === 'responses' ? `${config.baseUrl}/responses` : `${config.baseUrl}/chat/completions`
        const body = apiStyle === 'responses' ? buildResponsesBody(shared) : buildChatBody(shared)

        try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        if (response.ok) {
          const payload = await response.json()
          const text = apiStyle === 'responses' ? extractResponsesText(payload) : extractChatText(payload)
          if (!text) throw new Error(`${errorLabel}未返回内容`)
          rememberCapability(config, { apiStyle, jsonMode, dropExtras: !withExtras })
          return { text, payload, apiStyle, jsonMode }
        }

        const errorBody = await response.text()
        lastError = new Error(`${errorLabel}返回错误：${response.status} ${errorBody.slice(0, 240)}`)
        lastError.status = response.status

        // Structured-output mode rejected: fall back to a looser one.
        if (schema && jsonMode !== 'prompt' && looksLikeSchemaRejection(response.status, errorBody)) break
        // Optional tuning fields rejected: retry the same combination without them.
        if (withExtras && extrasOrder.length > 1 && looksLikeReasoningRejection(response.status, errorBody)) {
          continue
        }
        // The endpoint does not speak this dialect at all: try the next API style.
        if (looksLikeMissingEndpoint(response.status, errorBody)) {
          styleUnsupported = true
          break
        }
        throw lastError
        } catch (e) {
          // Transport/parse-level failure or unexpected status: record it and try the
          // next combination (other dialect / looser json / fewer extras) instead of
          // dying right away. The last error surfaces only after every combo is exhausted.
          lastError = e instanceof Error ? e : new Error(String(e))
          // Auth failures must surface immediately: probing other dialects would just
          // waste time and hide the real cause.

          if (lastError.status === 401 || lastError.status === 403) throw lastError
          continue
        }
      }

      if (styleUnsupported) break
    }
  }

  throw lastError || new Error(`${errorLabel}调用失败`)
}
