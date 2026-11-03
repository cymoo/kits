import { parseSettings } from '@kits/core'
import { describe, expect, it } from 'vitest'
import { kernelSettingsKey } from './kernel-config'

describe('kernelSettingsKey', () => {
  const base = parseSettings({
    defaultModel: 'corp/m',
    gateways: [{ id: 'corp', models: [{ id: 'm' }] }],
  })

  it('stays the same when only recent workdirs or appearance change', () => {
    const changed = {
      ...base,
      workdirs: [{ path: '/repo', lastUsedAt: 1 }],
      general: { ...base.general, theme: 'dark' as const },
    }
    expect(kernelSettingsKey(changed)).toBe(kernelSettingsKey(base))
  })

  it('changes when gateways, the default model or disabled skills change', () => {
    expect(kernelSettingsKey({ ...base, defaultModel: 'corp/n' })).not.toBe(kernelSettingsKey(base))
    expect(kernelSettingsKey({ ...base, skillsDisabled: ['x'] })).not.toBe(kernelSettingsKey(base))
    expect(kernelSettingsKey({ ...base, gateways: [] })).not.toBe(kernelSettingsKey(base))
  })
})
