import type { Settings } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { resolvePrefs } from './composer-prefs'

const settings = (patch: Partial<Settings>): Settings =>
  ({
    kernel: 'opencode',
    permissionMode: 'ask',
    workdirs: [],
    defaultModel: 'corp/m',
    gateways: [{ id: 'corp', enabled: true, models: [{ id: 'm' }, { id: 'n' }] }],
    ...patch,
  }) as unknown as Settings

const prefs = (model: string | undefined) => ({
  workdir: undefined,
  agent: 'assistant',
  permissionMode: undefined,
  kernel: undefined,
  model,
})

describe('resolvePrefs', () => {
  it('keeps a picked model that is still available', () => {
    expect(resolvePrefs(prefs('corp/n'), settings({})).model).toBe('corp/n')
  })

  it('falls back to the default model when the picked gateway is gone or disabled', () => {
    expect(resolvePrefs(prefs('old/x'), settings({})).model).toBe('corp/m')
  })

  it('leaves the model empty when nothing usable is configured', () => {
    expect(resolvePrefs(prefs('corp/n'), settings({ gateways: [] })).model).toBe('')
  })
})
