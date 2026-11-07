import { describe, expect, it } from 'vitest'
import { createStrayMouseFilter } from './stray-mouse'

describe('createStrayMouseFilter', () => {
  it('blocks a move without a button while a button is held', () => {
    const isStray = createStrayMouseFilter()
    isStray({ type: 'mouseDown', button: 'left' })
    expect(isStray({ type: 'mouseMove', button: 'none' })).toBe(true)
  })

  it('treats a move with no button field as having no button', () => {
    const isStray = createStrayMouseFilter()
    isStray({ type: 'mouseDown', button: 'left' })
    expect(isStray({ type: 'mouseMove' })).toBe(true)
  })

  it('lets a move with the held button through', () => {
    const isStray = createStrayMouseFilter()
    isStray({ type: 'mouseDown', button: 'left' })
    expect(isStray({ type: 'mouseMove', button: 'left' })).toBe(false)
  })

  it('lets a hover move through when no button is held', () => {
    const isStray = createStrayMouseFilter()
    expect(isStray({ type: 'mouseMove', button: 'none' })).toBe(false)
  })

  it('lets hover moves through again after the button is released', () => {
    const isStray = createStrayMouseFilter()
    isStray({ type: 'mouseDown', button: 'left' })
    isStray({ type: 'mouseUp', button: 'left' })
    expect(isStray({ type: 'mouseMove', button: 'none' })).toBe(false)
  })

  it('always blocks mouse leave', () => {
    const isStray = createStrayMouseFilter()
    expect(isStray({ type: 'mouseLeave', button: 'none' })).toBe(true)
  })

  it('never blocks the press and release themselves', () => {
    const isStray = createStrayMouseFilter()
    expect(isStray({ type: 'mouseDown', button: 'left' })).toBe(false)
    expect(isStray({ type: 'mouseUp', button: 'left' })).toBe(false)
  })
})
