import { describe, expect, it } from 'vitest'
import {
  basePermissions,
  defaultPermissions,
  effectiveLevel,
  isWriteTool,
  levelFor,
  matchPattern,
  type PermissionMode,
  type PermissionSet,
  resolvePermissions,
} from './permission'

const mcp = { servers: ['wiki'], rules: { 'wiki.get_page': 'allow' as const } }

// 解析结果对某个工具、某个输入的最终档位
function level(
  input: {
    mode: PermissionMode
    agent?: PermissionSet
    mcp?: { servers: string[]; rules: Record<string, 'allow' | 'ask' | 'deny'> }
    defaults?: PermissionSet
  },
  tool: string,
  arg = '*',
) {
  return effectiveLevel(resolvePermissions(input), tool, arg)
}

describe('defaultPermissions', () => {
  it('allows read-only commands and asks for everything else in bash', () => {
    expect(defaultPermissions.bash).toMatchObject({
      '*': 'ask',
      'git status': 'allow',
      'git status *': 'allow',
      'ls *': 'allow',
    })
  })

  it('only allows the listing forms of git branch', () => {
    expect(level({ mode: 'ask' }, 'bash', 'git branch')).toBe('allow')
    expect(level({ mode: 'ask' }, 'bash', 'git branch -a')).toBe('allow')
    expect(level({ mode: 'ask' }, 'bash', 'git branch -D feature')).toBe('ask')
  })

  it('sends redirects, command substitution and writing options back to the fallback level', () => {
    for (const cmd of [
      'echo hi > a.txt',
      'echo $(rm -rf x)',
      'cat `which sh`',
      'git diff --output=changes.txt',
      'git log --ext-diff',
      'find . -delete',
      'find . -exec rm {} ;',
      'rg --pre ./run.sh foo',
      'tree -o out.txt',
    ]) {
      expect(level({ mode: 'ask' }, 'bash', cmd), cmd).toBe('ask')
    }
    expect(level({ mode: 'ask' }, 'bash', 'git diff HEAD~1')).toBe('allow')
  })
})

describe('isWriteTool', () => {
  it('treats create, update, delete, push and send prefixes as writes', () => {
    for (const t of ['create_issue', 'update_page', 'delete_x', 'push_bug', 'send_mail']) {
      expect(isWriteTool(t)).toBe(true)
    }
    expect(isWriteTool('get_requirement')).toBe(false)
    expect(isWriteTool('list_updates')).toBe(false)
  })
})

describe('basePermissions', () => {
  it('asks for mcp tools whose names look like writes and keeps user settings', () => {
    const base = basePermissions({
      mode: 'ask',
      mcp: { servers: ['wiki'], rules: { 'wiki.update_page': 'allow' } },
    })
    expect(base['wiki_create_*']).toBe('ask')
    const keys = Object.keys(base)
    expect(keys.indexOf('wiki_update_page')).toBeGreaterThan(keys.indexOf('wiki_update_*'))
  })
})

describe('resolvePermissions', () => {
  it('uses the defaults in ask mode', () => {
    expect(level({ mode: 'ask' }, 'edit')).toBe('allow')
    expect(level({ mode: 'ask' }, 'bash', 'npm test')).toBe('ask')
    expect(level({ mode: 'ask' }, 'webfetch')).toBe('deny')
  })

  it('follows the mcp settings over the name guess', () => {
    expect(level({ mode: 'ask', mcp }, 'wiki_create_page')).toBe('ask')
    expect(level({ mode: 'ask', mcp }, 'wiki_get_page')).toBe('allow')
  })

  it('denies edits, non-whitelisted commands and mcp writes in read mode', () => {
    const m = {
      servers: ['wiki'],
      rules: { 'wiki.update_page': 'allow' as const, 'wiki.sync': 'ask' as const },
    }
    expect(level({ mode: 'read', mcp: m }, 'edit')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'external_directory')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'bash', 'npm test')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'bash', 'git diff')).toBe('allow')
    expect(level({ mode: 'read', mcp: m }, 'bash', 'echo a > b')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'wiki_create_page')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'wiki_update_page')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'wiki_sync')).toBe('deny')
  })

  it('keeps read mode write denies after an mcp wildcard allow', () => {
    const m = { servers: ['wiki'], rules: { 'wiki.*': 'allow' as const } }
    expect(level({ mode: 'read', mcp: m }, 'wiki_create_page')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'wiki_get_page')).toBe('allow')
    // ask 模式下用户的通配 allow 是明确的选择，照用户的
    expect(level({ mode: 'ask', mcp: m }, 'wiki_create_page')).toBe('allow')
  })

  it('allows bash and edit but still asks for outside dirs and mcp writes in auto mode', () => {
    expect(level({ mode: 'auto', mcp }, 'bash', 'rm -rf build')).toBe('allow')
    expect(level({ mode: 'auto', mcp }, 'edit')).toBe('allow')
    expect(level({ mode: 'auto', mcp }, 'external_directory')).toBe('ask')
    expect(level({ mode: 'auto', mcp }, 'wiki_send_mail')).toBe('ask')
  })

  it('applies agent deny in every mode', () => {
    for (const mode of ['ask', 'read', 'auto'] as const) {
      expect(level({ mode, agent: { bash: 'deny' } }, 'bash', 'git status')).toBe('deny')
      expect(level({ mode, agent: { edit: 'deny' } }, 'edit')).toBe('deny')
    }
  })

  it('applies agent allow and ask only in ask mode', () => {
    const agent = { bash: 'allow' as const, webfetch: 'ask' as const }
    expect(level({ mode: 'ask', agent }, 'bash', 'npm test')).toBe('allow')
    expect(level({ mode: 'ask', agent }, 'webfetch')).toBe('ask')
    expect(level({ mode: 'read', agent }, 'webfetch')).toBe('deny')
    expect(level({ mode: 'read', agent }, 'bash', 'npm test')).toBe('deny')
  })

  it('applies agent command patterns on top of the mode', () => {
    const agent = { bash: { 'rm *': 'deny' as const, 'npm *': 'allow' as const } }
    expect(level({ mode: 'auto', agent }, 'bash', 'rm -rf x')).toBe('deny')
    expect(level({ mode: 'auto', agent }, 'bash', 'ls')).toBe('allow')
    expect(level({ mode: 'ask', agent }, 'bash', 'npm test')).toBe('allow')
  })

  // 以下几条来自 review：通配键和具体键相交时，后写的规则都要压过前面的
  it('keeps an agent wildcard deny when the agent also adds command patterns', () => {
    for (const mode of ['ask', 'auto'] as const) {
      const agent = { '*': 'deny' as const, bash: { 'rm *': 'deny' as const } }
      expect(level({ mode, agent }, 'bash', 'touch unexpected.txt')).toBe('deny')
    }
  })

  it('lets later agent patterns override an earlier agent wildcard deny in ask mode', () => {
    const agent = { '*': 'deny' as const, bash: { 'git *': 'allow' as const } }
    expect(level({ mode: 'ask', agent }, 'bash', 'git log')).toBe('allow')
    expect(level({ mode: 'ask', agent }, 'bash', 'touch x')).toBe('deny')
  })

  it('does not lift a broad wildcard allow over a specific deny', () => {
    const agent = {
      'b*': 'allow' as const,
      bash: { 'rm *': 'deny' as const },
      'ba*': { 'ls *': 'deny' as const },
    }
    expect(level({ mode: 'ask', defaults: {}, agent }, 'bash', 'rm -rf example')).toBe('deny')
    expect(level({ mode: 'ask', defaults: {}, agent }, 'bash', 'ls a')).toBe('deny')
    expect(level({ mode: 'ask', defaults: {}, agent }, 'bash', 'pwd')).toBe('allow')
  })

  it('lets an agent wildcard deny beat an mcp allow on a more specific tool', () => {
    const m = { servers: ['wiki'], rules: { 'wiki.create_page': 'allow' as const } }
    for (const mode of ['ask', 'auto'] as const) {
      const agent = { 'wiki_create_*': { '*': 'deny' as const } }
      expect(level({ mode, mcp: m, agent }, 'wiki_create_page')).toBe('deny')
    }
  })

  it('honors declaration order between overlapping agent wildcards', () => {
    const m = { servers: ['wiki'], rules: {} }
    const denyLast = { 'wiki_*_page': 'allow' as const, 'wiki_create_*': { '*': 'deny' as const } }
    expect(level({ mode: 'ask', mcp: m, agent: denyLast }, 'wiki_create_page')).toBe('deny')
    expect(level({ mode: 'ask', mcp: m, agent: denyLast }, 'wiki_get_page')).toBe('allow')
    const broadLast = { 'wiki_create_*': 'deny' as const, 'wiki_*': 'allow' as const }
    expect(level({ mode: 'ask', mcp: m, agent: broadLast }, 'wiki_create_page')).toBe('allow')
  })

  it('always allows the kits tools, even after an agent wildcard deny', () => {
    const agent = { '*': 'deny' as const }
    expect(level({ mode: 'read', agent }, 'kits_ask_user')).toBe('allow')
    expect(level({ mode: 'read', agent }, 'kits_submit_output')).toBe('allow')
    expect(level({ mode: 'read', agent }, 'bash', 'ls')).toBe('deny')
  })

  it('does not allow tools of another server whose name starts with kits_', () => {
    const m = { servers: ['kits_wiki'], rules: {} }
    expect(level({ mode: 'read', mcp: m }, 'kits_wiki_delete_page')).toBe('deny')
    expect(level({ mode: 'read', mcp: m }, 'kits_remember')).toBe('allow')
  })
})

describe('matchPattern', () => {
  it('treats * as any run of characters and everything else literally', () => {
    expect(matchPattern('git status *', 'git status -s')).toBe(true)
    expect(matchPattern('*$(*', 'echo $(rm -rf x)')).toBe(true)
    expect(matchPattern('ls *', 'lsof')).toBe(false)
    expect(matchPattern('a.b', 'axb')).toBe(false)
  })
})

describe('levelFor', () => {
  it('uses the last matching pattern', () => {
    expect(
      levelFor({ '*': 'ask', 'git *': 'allow', 'git *--output*': 'ask' }, 'git diff --output=x'),
    ).toBe('ask')
    expect(levelFor('deny', 'anything')).toBe('deny')
    expect(levelFor({ a: 'allow' }, 'b')).toBeUndefined()
  })
})
