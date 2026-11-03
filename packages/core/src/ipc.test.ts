import { describe, expect, expectTypeOf, it } from 'vitest'
import { parseSettings } from './config/settings'
import { applySettingsPatch, contractEntries, type IpcHandlers, type KitsInvoke } from './ipc'

describe('contractEntries', () => {
  it('lists every domain and method of the contract', () => {
    expect(contractEntries()).toEqual([
      ['app', 'info'],
      ['app', 'openExternal'],
      ['app', 'openPath'],
      ['app', 'revealPath'],
      ['settings', 'get'],
      ['settings', 'update'],
      ['settings', 'loadError'],
      ['gateway', 'test'],
      ['kernel', 'status'],
      ['kernel', 'openLogs'],
      ['kernel', 'restart'],
      ['session', 'create'],
      ['session', 'list'],
      ['session', 'get'],
      ['session', 'prompt'],
      ['session', 'abort'],
      ['session', 'respondPermission'],
      ['session', 'answerQuestion'],
      ['session', 'diffs'],
      ['output', 'list'],
      ['output', 'save'],
      ['output', 'export'],
      ['workdir', 'pick'],
      ['agents', 'list'],
      ['secrets', 'set'],
      ['secrets', 'has'],
      ['secrets', 'remove'],
      ['secrets', 'encrypted'],
    ])
  })

  it('types methods without input as zero-argument calls', () => {
    expectTypeOf<KitsInvoke['settings']['get']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<KitsInvoke['secrets']['has']>().parameters.toEqualTypeOf<[string]>()
    expectTypeOf<IpcHandlers['secrets']['has']>().returns.toEqualTypeOf<
      boolean | Promise<boolean>
    >()
  })
})

describe('applySettingsPatch', () => {
  it('replaces top-level fields and merges general', () => {
    const base = parseSettings({ general: { theme: 'dark' }, kernel: 'opencode' })
    const next = applySettingsPatch(base, { kernel: 'codeagent', general: { uiScale: 's' } })
    expect(next.kernel).toBe('codeagent')
    expect(next.general).toMatchObject({ theme: 'dark', uiScale: 's' })
  })
})
