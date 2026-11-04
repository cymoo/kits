import { describe, expect, it } from 'vitest'
import { clampWidth, initialWidths, parseWidths } from './widths'

describe('clampWidth', () => {
  it('keeps a width inside the limits of that column', () => {
    expect(clampWidth('nav', 100)).toBe(200)
    expect(clampWidth('nav', 999)).toBe(360)
  })

  it('rounds to whole pixels', () => {
    expect(clampWidth('panel', 400.6)).toBe(401)
  })
})

describe('parseWidths', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(parseWidths(null)).toEqual(initialWidths)
  })

  it('falls back to the defaults when the stored value is broken', () => {
    expect(parseWidths('not json')).toEqual(initialWidths)
    expect(parseWidths('null')).toEqual(initialWidths)
  })

  it('keeps valid columns and resets the invalid ones', () => {
    expect(parseWidths('{"nav":300,"panel":"wide"}')).toEqual({ ...initialWidths, nav: 300 })
  })

  it('clamps a stored width that is out of range', () => {
    expect(parseWidths('{"chat":9999}').chat).toBe(640)
  })
})
