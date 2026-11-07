import { describe, expect, it } from 'vitest'
import {
  gutterChars,
  highlightSource,
  lineTokens,
  oneSided,
  parsePatch,
  splitPath,
  splitRows,
} from './patch'

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

  it('skips the file header of a patch that follows another one', () => {
    const twice = `${patch}\n${patch.replace('return 1', 'return 2')}`
    const lines = parsePatch(twice)
    expect(lines.filter((l) => l.kind === '@')).toHaveLength(2)
    expect(lines.some((l) => l.text.includes('src/a.py'))).toBe(false)
    expect(lines.filter((l) => l.kind === '-').map((l) => l.text)).toEqual([
      '    return 1',
      '    return 2',
    ])
  })

  it('reads a hunk header without line counts as one line on each side', () => {
    expect(parsePatch('@@ -3 +3 @@\n-a\n+b\n--- not a deletion\n')).toEqual([
      { kind: '@', text: '@@ -3 +3 @@' },
      { kind: '-', a: 3, text: 'a' },
      { kind: '+', b: 3, text: 'b' },
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

describe('gutterChars', () => {
  it('widens the line number column to fit the largest line number', () => {
    expect(gutterChars(parsePatch('@@ -9999,2 +9999,3 @@\n a\n+b\n c\n'))).toBe(5)
  })

  it('keeps at least two characters for short files', () => {
    expect(gutterChars(parsePatch('@@ -1 +1 @@\n-a\n+b\n'))).toBe(2)
  })
})

describe('oneSided', () => {
  it('treats a new file as one-sided', () => {
    expect(oneSided(parsePatch('@@ -0,0 +1,2 @@\n+a\n+b\n'))).toBe(true)
  })

  it('treats a deleted file as one-sided', () => {
    expect(oneSided(parsePatch('@@ -1,2 +0,0 @@\n-a\n-b\n'))).toBe(true)
  })

  it('treats a modified file as two-sided', () => {
    expect(oneSided(parsePatch(patch))).toBe(false)
  })
})

describe('highlightSource', () => {
  it('collects each side of the diff and maps every line to its row on that side', () => {
    const source = highlightSource(parsePatch(patch))
    expect(source.old).toBe('def redeem():\n    return 1\n# end')
    expect(source.new).toBe('def redeem():\n    cached = get()\n    return cached\n# end')
    expect(source.rows).toEqual([
      undefined,
      { side: 'new', row: 0 },
      { side: 'old', row: 1 },
      { side: 'new', row: 1 },
      { side: 'new', row: 2 },
      { side: 'new', row: 3 },
    ])
  })
})

describe('lineTokens', () => {
  const source = highlightSource(parsePatch(patch))
  const done = { source, old: ['o0', 'o1', 'o2'], new: ['n0', 'n1', 'n2', 'n3'] }

  it('takes the tokens of each line from its own side', () => {
    expect([0, 1, 2, 3].map((i) => lineTokens(source, done, i))).toEqual([
      undefined,
      'n0',
      'o1',
      'n1',
    ])
  })

  it('ignores tokens highlighted from an earlier patch of the same file', () => {
    const refreshed = highlightSource(parsePatch(patch.replace('return 1', 'return 2')))
    expect(lineTokens(refreshed, done, 2)).toBeUndefined()
  })

  it('shows plain text when the new patch is no longer highlighted', () => {
    expect(lineTokens(source, undefined, 1)).toBeUndefined()
  })
})

describe('splitPath', () => {
  it('splits a path into its folder and file name', () => {
    expect(splitPath('src/points/redeem.py')).toEqual({ dir: 'src/points/', name: 'redeem.py' })
  })

  it('splits a Windows path at the last backslash', () => {
    expect(splitPath('C:\\work\\a.py')).toEqual({ dir: 'C:\\work\\', name: 'a.py' })
  })

  it('leaves a bare file name without a folder', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })
})
