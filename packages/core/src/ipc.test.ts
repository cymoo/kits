import { describe, expect, expectTypeOf, it } from 'vitest'
import { parseSettings } from './config/settings'
import { applySettingsPatch, contractEntries, type IpcHandlers, type KitsInvoke } from './ipc'

describe('contractEntries', () => {
  it('lists every domain and method of the contract', () => {
    expect(contractEntries()).toEqual([
      ['app', 'info'],
      ['app', 'checkForUpdates'],
      ['app', 'permissionDefaults'],
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
      ['session', 'search'],
      ['session', 'remove'],
      ['session', 'rename'],
      ['session', 'setPinned'],
      ['session', 'setPermissionMode'],
      ['session', 'setModel'],
      ['session', 'export'],
      ['session', 'compact'],
      ['session', 'prompt'],
      ['session', 'abort'],
      ['session', 'dequeue'],
      ['session', 'interject'],
      ['session', 'respondPermission'],
      ['session', 'answerQuestion'],
      ['session', 'diffs'],
      ['output', 'list'],
      ['output', 'export'],
      ['mcp', 'overview'],
      ['mcp', 'parse'],
      ['mcp', 'add'],
      ['mcp', 'remove'],
      ['mcp', 'setEnabled'],
      ['mcp', 'setPermission'],
      ['mcp', 'test'],
      ['skills', 'list'],
      ['skills', 'setEnabled'],
      ['skills', 'openDir'],
      ['memory', 'list'],
      ['memory', 'add'],
      ['memory', 'update'],
      ['memory', 'remove'],
      ['memory', 'open'],
      ['files', 'search'],
      ['files', 'list'],
      ['files', 'read'],
      ['files', 'open'],
      ['workdir', 'pick'],
      ['workdir', 'rename'],
      ['workdir', 'remove'],
      ['workdir', 'inspect'],
      ['workdir', 'createDefault'],
      ['agents', 'list'],
      ['agents', 'overview'],
      ['agents', 'save'],
      ['agents', 'remove'],
      ['agents', 'preview'],
      ['agents', 'createOutput'],
      ['agents', 'open'],
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
