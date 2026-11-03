import type { SessionSummary } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { continueCards, matchesFilter, whenLabel } from './session-labels'

const now = new Date(2026, 10, 4, 15, 30).getTime()
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()

describe('whenLabel', () => {
  it('says minutes and hours for today', () => {
    expect(whenLabel(now - 20_000, now)).toBe('刚刚')
    expect(whenLabel(now - 12 * 60_000, now)).toBe('12 分钟前')
    expect(whenLabel(at(4, 9), now)).toBe('6 小时前')
  })

  it('says yesterday with the time, then the weekday within a week', () => {
    expect(whenLabel(at(3, 14, 5), now)).toBe('昨天 14:05')
    expect(whenLabel(at(2, 10), now)).toBe('周一')
  })

  it('says the date for older sessions', () => {
    expect(whenLabel(at(20, 10) - 31 * 86_400_000, now)).toBe('10月20日')
    expect(whenLabel(new Date(2025, 0, 2).getTime(), now)).toBe('2025-01-02')
  })
})

const s = (id: string, status: SessionSummary['status'], updatedAt: number) =>
  ({ id, status, updatedAt }) as SessionSummary

describe('matchesFilter', () => {
  it('counts errors as needing attention', () => {
    expect(matchesFilter(s('a', 'error', 1), 'attention')).toBe(true)
    expect(matchesFilter(s('a', 'running', 1), 'attention')).toBe(false)
  })
})

describe('continueCards', () => {
  it('puts sessions waiting for the user first', () => {
    const list = [s('done', 'done', 3), s('wait', 'waiting', 1), s('err', 'error', 2)]
    expect(continueCards(list).map((x) => x.id)).toEqual(['wait', 'err', 'done'])
  })
})
