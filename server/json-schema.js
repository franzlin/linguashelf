// Small runtime validator for the JSON Schema subset used by LinguaShelf's AI
// responses. Upstream structured-output support is helpful but not trusted:
// compatible relays may ignore it and still return parseable, malformed JSON.

export function jsonSchemaErrors(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return []
  const errors = []

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} 必须是 ${schema.enum.join('、')} 之一`)
    return errors
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} 应为 ${schema.type}`)
    return errors
  }

  if (schema.type === 'object') {
    const properties = schema.properties || {}
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} 缺失`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} 不在允许的结构中`)
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...jsonSchemaErrors(value[key], childSchema, `${path}.${key}`))
      }
    }
  }

  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} 至少需要 ${schema.minItems} 项`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} 最多允许 ${schema.maxItems} 项`)
    if (schema.items) value.forEach((item, index) => errors.push(...jsonSchemaErrors(item, schema.items, `${path}[${index}]`)))
  }

  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} 长度不能小于 ${schema.minLength}`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} 长度不能大于 ${schema.maxLength}`)
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} 不能小于 ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} 不能大于 ${schema.maximum}`)
  }

  return errors
}

export function assertJsonSchema(value, schema, label = 'AI 服务返回内容') {
  const errors = jsonSchemaErrors(value, schema)
  if (!errors.length) return value
  throw new Error(`${label}结构不符合要求：${errors.slice(0, 4).join('；')}`)
}

function matchesType(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return true
}
