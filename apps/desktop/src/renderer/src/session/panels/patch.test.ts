import { describe, expect, it } from 'vitest'
import { parsePatch, splitRows } from './patch'

const patch = [
  'Index: src/a.py',
  '===================================================================',
  '--- src/a.py',
  '+++ src/a.py',
  '@@ -10,3 +10,4 @@',
  ' def redeem():',
  '-    return 1',
  '+    cached = get()',
  '+    return cached',
  ' # end',
  '\\ No newline at end of file',
  '',
].join('\n')

describe('parsePatch', () => {
  it('skips file headers and numbers the old and new lines from the hunk header', () => {
    expect(parsePatch(patch)).toEqual([
      { kind: '@', text: '@@ -10,3 +10,4 @@' },
      { kind: ' ', a: 10, b: 10, text: 'def redeem():' },
      { kind: '-', a: 11, text: '    return 1' },
      { kind: '+', b: 11, text: '    cached = get()' },
      { kind: '+', b: 12, text: '    return cached' },
      { kind: ' ', a: 12, b: 13, text: '# end' },
    ])
  })

  it('returns nothing for an empty patch', () => {
    expect(parsePatch('')).toEqual([])
  })
})

describe('splitRows', () => {
  it('pairs a run of deletions with the additions that follow and leaves the rest one-sided', () => {
    const rows = splitRows(parsePatch(patch))
    expect(rows.map((r) => [r.hunk?.kind, r.left?.kind, r.right?.kind])).toEqual([
      ['@', undefined, undefined],
      [undefined, ' ', ' '],
      [undefined, '-', '+'],
      [undefined, undefined, '+'],
      [undefined, ' ', ' '],
    ])
  })
})
