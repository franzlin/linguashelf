// Unit tests for the custom AI endpoint form logic.
// Run with: node scripts/test-ai-config-form.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const formSource = await readFile(new URL('../src/lib/ai-config-form.ts', import.meta.url), 'utf8')
const transpiledForm = ts.transpileModule(formSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const formModuleUrl = `data:text/javascript;base64,${Buffer.from(transpiledForm.outputText).toString('base64')}`
const { KEY_CLEARED, buildCapabilityPatch, initialDraft } = await import(formModuleUrl)

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}\n      ${error.message}`)
  }
}

const FIELDS = [
  { name: 'baseUrl', label: '接口地址', kind: 'url' },
  { name: 'apiKey', label: 'API Key', kind: 'secret' },
  { name: 'model', label: '模型名称', kind: 'text' },
  { name: 'apiStyle', label: '接口风格', kind: 'select' },
]

console.log('AI config form unit tests')

test('a freshly opened form never pre-fills the key', () => {
  const draft = initialDraft(FIELDS, { baseUrl: 'https://a.test/v1', apiKey: 'sk-secret', model: 'm', apiStyle: 'chat' })
  assert.equal(draft.apiKey, '', 'the stored secret must not reach the form state')
  assert.equal(draft.baseUrl, 'https://a.test/v1')
  assert.equal(draft.model, 'm')
  assert.equal(draft.apiStyle, 'chat')
})

test('an untouched form produces an empty patch', () => {
  const stored = { baseUrl: 'https://a.test/v1', apiKey: 'sk-secret', model: 'm', apiStyle: 'auto' }
  const initial = initialDraft(FIELDS, stored)
  assert.deepEqual(buildCapabilityPatch(FIELDS, initial, initial), {})
})

test('saving without touching the key never clears the stored key', () => {
  const stored = { baseUrl: 'https://a.test/v1', apiKey: 'sk-secret', model: 'm' }
  const initial = initialDraft(FIELDS, stored)
  const patch = buildCapabilityPatch(FIELDS, { ...initial, model: 'new-model' }, initial)
  assert.deepEqual(patch, { model: 'new-model' })
  assert.equal('apiKey' in patch, false, 'a blank key field must be omitted, not sent as empty')
})

test('a typed key is sent trimmed', () => {
  const initial = initialDraft(FIELDS, {})
  const patch = buildCapabilityPatch(FIELDS, { ...initial, apiKey: '  sk-new  ' }, initial)
  assert.equal(patch.apiKey, 'sk-new')
})

test('the clear sentinel sends an explicit null', () => {
  const initial = initialDraft(FIELDS, { apiKey: 'sk-secret' })
  const patch = buildCapabilityPatch(FIELDS, { ...initial, apiKey: KEY_CLEARED }, initial)
  assert.equal(patch.apiKey, null)
})

test('emptying a text field is sent as a deliberate clear', () => {
  const initial = initialDraft(FIELDS, { baseUrl: 'https://a.test/v1', model: 'm' })
  const patch = buildCapabilityPatch(FIELDS, { ...initial, baseUrl: '' }, initial)
  assert.deepEqual(patch, { baseUrl: '' })
})

test('only changed fields are sent', () => {
  const initial = initialDraft(FIELDS, { baseUrl: 'https://a.test/v1', model: 'm', apiStyle: 'auto' })
  const patch = buildCapabilityPatch(FIELDS, { ...initial, apiStyle: 'chat' }, initial)
  assert.deepEqual(patch, { apiStyle: 'chat' })
})

test('the sentinel is not a value a user could type by accident', () => {
  assert.ok(KEY_CLEARED.startsWith('__') && KEY_CLEARED.endsWith('__'))
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
