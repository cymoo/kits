import type { AgentDraft } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { sameDraft, setToolLevel, toggleAllowed, toolLevel, uniqueName } from './agent-edit'

const defaults = { read: 'allow', edit: 'allow', bash: 'ask' } as const
const draft = (patch: Partial<AgentDraft> = {}): AgentDraft => ({
  name: 'a',
  description: '',
  permissions: {},
  prompt: '',
  ...patch,
})

describe('toolLevel', () => {
  it('shows tools outside the allow list as denied', () => {
    expect(toolLevel(draft({ tools: ['read'] }), 'edit', defaults)).toBe('deny')
  })

  it('reads the wildcard of a pattern rule', () => {
    expect(
      toolLevel(draft({ permissions: { bash: { '*': 'deny', ls: 'allow' } } }), 'bash', defaults),
    ).toBe('deny')
  })

  it('falls back to the default level', () => {
    expect(toolLevel(draft(), 'bash', defaults)).toBe('ask')
  })
})

describe('setToolLevel', () => {
  it('drops the override when the level equals the default', () => {
    const next = setToolLevel(draft({ permissions: { bash: 'deny' } }), 'bash', 'ask', defaults)
    expect(next.permissions).toEqual({})
  })

  it('adds the tool back to the allow list when it is no longer denied', () => {
    const next = setToolLevel(draft({ tools: ['edit'] }), 'read', 'allow', defaults)
    expect(next.tools).toEqual(['edit', 'read', 'grep', 'glob'])
  })
})

describe('toggleAllowed', () => {
  it('expands "all" into an explicit list when one is turned off', () => {
    expect(toggleAllowed(undefined, ['x', 'y'], 'x')).toEqual(['y'])
  })

  it('goes back to "all" when every item is on again', () => {
    expect(toggleAllowed(['y'], ['x', 'y'], 'x')).toBeUndefined()
  })
})

describe('uniqueName', () => {
  it('appends a number when the name is taken', () => {
    expect(uniqueName('new-agent', ['new-agent', 'new-agent-2'])).toBe('new-agent-3')
  })
})

describe('sameDraft', () => {
  it('ignores an empty model and trailing whitespace in the prompt', () => {
    expect(sameDraft(draft({ prompt: 'hi\n' }), draft({ prompt: 'hi', model: '' }))).toBe(true)
  })
})
