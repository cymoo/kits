import { describe, expect, it } from 'vitest'
import { relativeTime } from './relative-time'

const now = new Date(2026, 10, 6, 15, 0).getTime()
const at = (...args: [number, number, number, number]) => new Date(2026, ...args).getTime()

describe('relativeTime', () => {
  it('calls the last minute just now', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚')
  })

  it('counts minutes within the hour', () => {
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12 分钟')
  })

  it('counts hours within today', () => {
    expect(relativeTime(at(10, 6, 9, 30), now)).toBe('5 小时')
  })

  it('calls the previous calendar day yesterday even a few hours ago', () => {
    const lateNight = new Date(2026, 10, 6, 0, 30).getTime()
    expect(relativeTime(at(10, 5, 23, 0), lateNight)).toBe('昨天')
  })

  it('counts days within a month', () => {
    expect(relativeTime(at(10, 3, 12, 0), now)).toBe('3 天')
  })

  it('writes the date after a month', () => {
    expect(relativeTime(at(8, 20, 12, 0), now)).toBe('9/20')
  })
})
