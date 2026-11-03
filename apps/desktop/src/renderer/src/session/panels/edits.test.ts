import { describe, expect, it } from 'vitest'
import { countEdits } from './edits'

describe('countEdits', () => {
  it('counts each run of changed lines once', () => {
    const before = ['# 标题', '第一段', '第二段', '第三段', '结尾'].join('\n')
    const after = ['# 标题', '第一段改了', '第二段', '第三段', '多了一行', '结尾'].join('\n')
    expect(countEdits(before, after)).toBe(2)
  })

  it('is zero for the same text', () => {
    expect(countEdits('a\nb', 'a\nb')).toBe(0)
  })

  it('treats an appended block as one edit', () => {
    expect(countEdits('a', 'a\nb\nc')).toBe(1)
  })
})
