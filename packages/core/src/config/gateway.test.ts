import { describe, expect, it } from 'vitest'
import { imageSupport } from './gateway'

const gateway = (vision: boolean) => ({
  id: 'g',
  name: '',
  baseUrl: '',
  enabled: true,
  models: [{ id: 'm', note: '', contextWindow: 1, toolCall: true, vision }],
})

describe('imageSupport', () => {
  it('follows the settings when no restart is pending', () => {
    expect(imageSupport([gateway(true)], undefined, 'g/m')).toBe('yes')
    expect(imageSupport([gateway(false)], undefined, 'g/m')).toBe('no')
  })

  it('waits for the kernel when the switch was turned on after it started', () => {
    expect(imageSupport([gateway(true)], [gateway(false)], 'g/m')).toBe('restarting')
  })

  it('goes by the settings when the switch was turned off', () => {
    expect(imageSupport([gateway(false)], [gateway(true)], 'g/m')).toBe('no')
  })

  it('needs no restart when the kernel already loaded the switch', () => {
    expect(imageSupport([gateway(true)], [gateway(true)], 'g/m')).toBe('yes')
  })

  it('is no for a model it does not know', () => {
    expect(imageSupport([gateway(true)], undefined, 'g/other')).toBe('no')
  })
})
