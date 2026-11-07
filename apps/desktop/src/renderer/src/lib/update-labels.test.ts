import type { SessionSummary } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { busySessionCount, checkedLabel, releaseDay } from './update-labels'

const session = (status: SessionSummary['status'], queued?: unknown[]) =>
  ({ id: status, status, ...(queued ? { queued } : {}) }) as unknown as SessionSummary

describe('busySessionCount', () => {
  it('counts running, waiting and queued sessions as busy', () => {
    const list = [
      session('running'),
      session('waiting'),
      session('done', [{}]),
      session('done'),
      session('error'),
    ]
    expect(busySessionCount(list)).toBe(3)
  })

  it('is zero before the session list has loaded', () => {
    expect(busySessionCount(undefined)).toBe(0)
  })
})

describe('releaseDay', () => {
  it('writes the month and day of the release', () => {
    expect(releaseDay('2026-11-07T04:00:00.000Z')).toBe('11 月 7 日')
  })

  it('is empty without a valid date', () => {
    expect(releaseDay(null)).toBe('')
    expect(releaseDay('soon')).toBe('')
  })
})

describe('checkedLabel', () => {
  const now = new Date(2026, 10, 7, 15, 30).getTime()

  it('says minutes ago within the hour', () => {
    expect(checkedLabel(now - 12 * 60_000, now)).toBe('12 分钟前')
    expect(checkedLabel(now - 10_000, now)).toBe('刚刚')
  })

  it('writes the time of day for earlier today', () => {
    expect(checkedLabel(new Date(2026, 10, 7, 9, 5).getTime(), now)).toBe('09:05')
  })

  it('writes the date for another day', () => {
    expect(checkedLabel(new Date(2026, 10, 6, 22, 0).getTime(), now)).toBe('11 月 6 日')
  })
})
