import { describe, expect, it } from 'vitest'
import { checkJsonSchema, validateOutput } from './submit-output'

const schema = {
  type: 'object',
  required: ['cases'],
  properties: {
    cases: {
      type: 'array',
      items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    },
  },
}

describe('validateOutput', () => {
  it('accepts output that matches the schema', () => {
    expect(validateOutput(schema, { cases: [{ title: 'a' }] })).toEqual({
      ok: true,
      output: { cases: [{ title: 'a' }] },
    })
  })

  it('returns readable errors for output that misses a required field', () => {
    const result = validateOutput(schema, { cases: [{}] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('title')
  })
})

describe('checkJsonSchema', () => {
  it('accepts a normal nested schema', () => {
    expect(checkJsonSchema(schema)).toEqual([])
  })

  it('points at a nested property with an unknown type', () => {
    const bad = { type: 'object', properties: { a: { type: 'array', items: { type: 'str' } } } }
    expect(checkJsonSchema(bad)).toEqual(['#/properties/a/items/type 不认识：str'])
  })

  it('rejects required that is not a string list', () => {
    expect(checkJsonSchema({ required: 'a' })).toHaveLength(1)
  })

  it('rejects a schema that is not an object', () => {
    expect(checkJsonSchema([])).toHaveLength(1)
  })
})
