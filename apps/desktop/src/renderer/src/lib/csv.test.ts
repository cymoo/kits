import { describe, expect, it } from 'vitest'
import { parseTable } from './csv'

describe('parseTable', () => {
  it('splits rows and cells', () => {
    expect(parseTable('a,b\n1,2\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a separator and a line break inside quotes', () => {
    expect(parseTable('"a,b","c\nd"', ',')).toEqual([['a,b', 'c\nd']])
  })

  it('reads a doubled quote as one quote', () => {
    expect(parseTable('"say ""hi"""', ',')).toEqual([['say "hi"']])
  })

  it('accepts Windows line endings', () => {
    expect(parseTable('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps the last row without a line break', () => {
    expect(parseTable('a\nb', ',').at(-1)).toEqual(['b'])
  })

  it('splits on tabs for tsv', () => {
    expect(parseTable('a\tb', '\t')).toEqual([['a', 'b']])
  })

  it('stops at the row limit', () => {
    expect(parseTable('a\nb\nc\n', ',', 2)).toHaveLength(2)
  })
})
