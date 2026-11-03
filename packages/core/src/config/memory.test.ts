import { describe, expect, it } from 'vitest'
import { appendMemory, formatMemoryEntry, parseMemory, updateMemory } from './memory'

const file = [
  '# 项目记忆',
  '',
  '- 测试命令是 uv run pytest，不要用 python -m pytest。 <!-- session:01J9 2026-10-29 -->',
  '- 接口返回时间一律 ISO 8601 带时区。 <!-- manual 2026-10-27 -->',
  '- 人手写的一条',
  '',
].join('\n')

describe('parseMemory', () => {
  it('reads list items with their source and date', () => {
    expect(parseMemory(file)).toEqual([
      {
        text: '测试命令是 uv run pytest，不要用 python -m pytest。',
        source: 'session:01J9',
        date: '2026-10-29',
      },
      { text: '接口返回时间一律 ISO 8601 带时区。', source: 'manual', date: '2026-10-27' },
      { text: '人手写的一条', source: '', date: '' },
    ])
  })
})

describe('formatMemoryEntry', () => {
  it('folds a multi-line text into one line', () => {
    expect(formatMemoryEntry({ text: 'a\nb', source: 'manual', date: '2026-11-01' })).toBe(
      '- a b <!-- manual 2026-11-01 -->',
    )
  })
})

describe('appendMemory', () => {
  it('adds a line at the end and keeps a trailing newline', () => {
    const next = appendMemory(file, { text: '新的', source: 'manual', date: '2026-11-04' })
    expect(next.endsWith('- 新的 <!-- manual 2026-11-04 -->\n')).toBe(true)
    expect(parseMemory(next)).toHaveLength(4)
  })

  it('starts an empty file without a blank line', () => {
    expect(appendMemory('', { text: 'x', source: '', date: '' })).toBe('- x\n')
  })
})

describe('updateMemory', () => {
  it('replaces the entry at an index and keeps the other lines', () => {
    const next = updateMemory(file, 1, { text: '改过', source: 'manual', date: '2026-11-04' })
    expect(next.startsWith('# 项目记忆\n')).toBe(true)
    expect(parseMemory(next)[1]?.text).toBe('改过')
  })

  it('removes the entry when given null', () => {
    const next = updateMemory(file, 0, null)
    expect(parseMemory(next).map((e) => e.text)).toEqual([
      '接口返回时间一律 ISO 8601 带时区。',
      '人手写的一条',
    ])
  })

  it('throws for an index past the end', () => {
    expect(() => updateMemory(file, 5, null)).toThrow()
  })
})
