import type { OutputView } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import type { Block } from './derive'
import { outputCount, placeOutputs } from './outputs'

const output = (id: string, turn: number) => ({ id, turn, kind: 'structured' }) as OutputView
const block = (kind: string, turn?: number) => ({ kind, id: kind, turn }) as Block

describe('placeOutputs', () => {
  it('puts the card after the reply of its turn', () => {
    const blocks = [block('user'), block('turn', 1), block('text'), block('user')]
    expect(placeOutputs(blocks, [output('o', 1)]).map((b) => b.kind)).toEqual([
      'user',
      'turn',
      'text',
      'output',
      'user',
    ])
  })

  it('keeps the order of two outputs of a turn', () => {
    const placed = placeOutputs([block('turn', 1)], [output('a', 1), output('b', 1)])
    expect(placed.map((b) => b.id)).toEqual(['turn', 'output:a', 'output:b'])
  })

  it('puts the card after the second part of a turn split by an interjection', () => {
    const blocks = [block('turn', 1), block('user'), block('turn', 1), block('text')]
    expect(placeOutputs(blocks, [output('o', 1)]).at(-1)?.kind).toBe('output')
  })

  it('appends the card when its turn shows no steps', () => {
    expect(placeOutputs([block('user')], [output('o', 3)]).at(-1)?.kind).toBe('output')
  })
})

describe('outputCount', () => {
  it('counts a list', () => {
    expect(outputCount([1, 2])).toBe(2)
  })

  it('counts the first list of an object', () => {
    expect(outputCount({ total: 3, findings: [1, 2, 3] })).toBe(3)
  })

  it('has no count for a plain value', () => {
    expect(outputCount({ ok: true })).toBeUndefined()
  })
})
