import { describe, expect, it } from 'vitest'
import { validateOutput } from './submit-output'

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
