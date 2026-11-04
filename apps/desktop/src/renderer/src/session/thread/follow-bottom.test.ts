import { describe, expect, it } from 'vitest'
import { nearBottom, stillFollowing } from './follow-bottom'

const at = (scrollTop: number, scrollHeight = 1000) => ({
  scrollTop,
  scrollHeight,
  clientHeight: 400,
})

describe('nearBottom', () => {
  it('counts the last 40 pixels as the bottom', () => {
    expect(nearBottom(at(561))).toBe(true)
    expect(nearBottom(at(560))).toBe(false)
  })
})

describe('stillFollowing', () => {
  it('stops following when the user scrolls up', () => {
    expect(stillFollowing(true, at(300), 600)).toBe(false)
  })

  it('keeps following when the content grew but the position did not move', () => {
    expect(stillFollowing(true, at(600, 1400), 600)).toBe(true)
  })

  it('stays off when the user scrolls down but has not reached the bottom', () => {
    expect(stillFollowing(false, at(400), 300)).toBe(false)
  })

  it('follows again once the user is back at the bottom', () => {
    expect(stillFollowing(false, at(590), 300)).toBe(true)
  })
})
