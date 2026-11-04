import { describe, expect, it } from 'vitest'
import { MENU_MAX_HEIGHT, placeMenu } from './composer-menu'

describe('placeMenu', () => {
  it('opens upwards at full height when there is room', () => {
    expect(placeMenu(600, 40)).toEqual({ side: 'up', maxHeight: MENU_MAX_HEIGHT })
  })

  it('shrinks to the room above when that is still enough', () => {
    expect(placeMenu(252, 330)).toEqual({ side: 'up', maxHeight: 252 })
  })

  it('opens downwards when the room above is too small and below is larger', () => {
    expect(placeMenu(140, 300)).toEqual({ side: 'down', maxHeight: 300 })
  })

  it('stays upwards when neither side is enough but above is larger', () => {
    expect(placeMenu(150, 100)).toEqual({ side: 'up', maxHeight: 150 })
  })
})
