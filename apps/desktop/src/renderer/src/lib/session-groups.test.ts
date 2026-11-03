import type { SessionSummary } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { groupOf, groupSessions } from './session-groups'

const now = new Date(2026, 10, 4, 15, 0)
const at = (days: number, hour = 10) => new Date(2026, 10, 4 - days, hour).getTime()

describe('groupOf', () => {
  it('groups by calendar day, not by 24 hours', () => {
    expect(groupOf(at(0, 0), now)).toBe('today')
    expect(groupOf(at(1, 23), now)).toBe('yesterday')
    expect(groupOf(at(6), now)).toBe('week')
    expect(groupOf(at(7), now)).toBe('earlier')
  })
})

describe('groupOf across a daylight saving change', () => {
  it('puts the first hour of yesterday in yesterday when yesterday had 25 hours', () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // 2026-11-01 夏令时结束，那天有 25 小时
      const now = new Date(2026, 10, 2, 12)
      expect(groupOf(new Date(2026, 10, 1, 0, 30).getTime(), now)).toBe('yesterday')
      expect(groupOf(new Date(2026, 9, 27, 0, 30).getTime(), now)).toBe('week')
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

describe('groupSessions', () => {
  it('keeps the group order and the order inside a group', () => {
    const s = (id: string, updatedAt: number) => ({ id, updatedAt }) as SessionSummary
    const groups = groupSessions(
      [s('a', at(0)), s('b', at(10)), s('c', at(0, 8)), s('d', at(1))],
      now,
    )
    expect(groups.map(([g, items]) => [g, items.map((x) => x.id)])).toEqual([
      ['today', ['a', 'c']],
      ['yesterday', ['d']],
      ['earlier', ['b']],
    ])
  })
})
