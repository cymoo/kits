import { describe, expect, it } from 'vitest'
import { atQuery, formatSize, insertAt } from './composer-at'

describe('atQuery', () => {
  it('finds an @ at the start or after whitespace up to the caret', () => {
    expect(atQuery('看下 @src/po', 10)).toEqual({ start: 3, query: 'src/po' })
    expect(atQuery('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('ignores an @ inside a word such as an email', () => {
    expect(atQuery('发给 a@b.com', 10)).toBeUndefined()
  })

  it('stops once there is a space after the reference', () => {
    expect(atQuery('看下 @src/a.py 然后', 15)).toBeUndefined()
  })
})

describe('insertAt', () => {
  it('replaces the typed query with the picked path and a space', () => {
    const text = '看下 @red 怎么写的'
    const at = atQuery(text, 7)
    expect(at && insertAt(text, at, 7, 'src/points/redeem.py')).toEqual({
      text: '看下 @src/points/redeem.py 怎么写的',
      caret: 25,
    })
  })
})

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect([formatSize(900), formatSize(12_600), formatSize(1_300_000)]).toEqual([
      '900 B',
      '12.3 KB',
      '1.2 MB',
    ])
  })
})
