import { Validator } from '@cfworker/json-schema'

// 提交结构化结果：按 Agent 的 JSON Schema 校验，不合格把错误返回给模型让它改。

export type SubmitOutputResult = { ok: true; output: unknown } | { ok: false; errors: string[] }

export function validateOutput(
  schema: Record<string, unknown>,
  output: unknown,
): SubmitOutputResult {
  const validator = new Validator(schema as never, '2020-12', false)
  const result = validator.validate(output)
  if (result.valid) return { ok: true, output }
  return {
    ok: false,
    errors: result.errors.map((e) => `${e.instanceLocation}: ${e.error}`),
  }
}

const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions']
const SUBSCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SUBSCHEMAS = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains']

// 校验器本身不检查 schema 写得对不对，坏 schema 会在模型提交时才报出来。
// 这里在加载 Agent 时先做结构检查：type 是不是合法类型、子 schema 是不是对象、required 是不是字符串数组。
export function checkJsonSchema(schema: unknown, at = '#'): string[] {
  if (typeof schema === 'boolean') return []
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return [`${at} 应该是对象`]
  }
  const s = schema as Record<string, unknown>
  const problems: string[] = []
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type]
    for (const t of types) {
      if (typeof t !== 'string' || !JSON_TYPES.has(t))
        problems.push(`${at}/type 不认识：${String(t)}`)
    }
  }
  if (
    s.required !== undefined &&
    !(Array.isArray(s.required) && s.required.every((r) => typeof r === 'string'))
  ) {
    problems.push(`${at}/required 应该是字符串数组`)
  }
  for (const key of SUBSCHEMA_MAPS) {
    const map = s[key]
    if (map === undefined) continue
    if (typeof map !== 'object' || map === null || Array.isArray(map)) {
      problems.push(`${at}/${key} 应该是对象`)
      continue
    }
    for (const [name, sub] of Object.entries(map)) {
      problems.push(...checkJsonSchema(sub, `${at}/${key}/${name}`))
    }
  }
  for (const key of SUBSCHEMA_LISTS) {
    const list = s[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      problems.push(`${at}/${key} 应该是数组`)
      continue
    }
    list.forEach((sub, i) => {
      problems.push(...checkJsonSchema(sub, `${at}/${key}/${i}`))
    })
  }
  for (const key of SUBSCHEMAS) {
    if (s[key] !== undefined) problems.push(...checkJsonSchema(s[key], `${at}/${key}`))
  }
  return problems
}
