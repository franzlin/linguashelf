// Pure form logic for the custom AI endpoint editor.
//
// Kept out of the component so the rules that decide what gets sent to the
// server — especially "an untouched key field must never clear a stored key" —
// can be tested without a DOM.

export type AiConfigFieldKind = 'url' | 'text' | 'secret' | 'select' | 'longtext'

export type AiConfigField = {
  name: string
  label: string
  kind: AiConfigFieldKind
  hint?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

/** Sentinel stored in the draft when the user asks to drop a saved key. */
export const KEY_CLEARED = '__cleared__'

/**
 * Builds the minimal patch to send for one capability.
 *
 * - non-secret fields are included only when changed, so a partial save never
 *   disturbs fields the user did not touch
 * - an empty string is a deliberate "clear this and fall back to .env"
 * - a blank key field is omitted entirely; only `KEY_CLEARED` removes a key
 */
export function buildCapabilityPatch(
  fields: AiConfigField[],
  draft: Record<string, string>,
  initial: Record<string, string>,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {}

  for (const field of fields) {
    const value = draft[field.name] ?? ''

    if (field.kind === 'secret') {
      if (value === KEY_CLEARED) patch[field.name] = null
      else if (value.trim()) patch[field.name] = value.trim()
      continue
    }

    if (value !== (initial[field.name] ?? '')) patch[field.name] = value
  }

  return patch
}

/** The draft a freshly opened form starts from: stored values, never secrets. */
export function initialDraft(fields: AiConfigField[], stored: Record<string, unknown> | undefined) {
  const draft: Record<string, string> = {}
  for (const field of fields) {
    if (field.kind === 'secret') {
      draft[field.name] = ''
      continue
    }
    const value = stored?.[field.name]
    draft[field.name] = typeof value === 'string' ? value : ''
  }
  return draft
}
