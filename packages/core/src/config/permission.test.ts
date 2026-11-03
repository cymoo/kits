import { describe, expect, it } from 'vitest'
import {
  defaultPermissions,
  effectiveLevel,
  isWriteTool,
  levelFor,
  matchPattern,
  resolvePermissions,
} from './permission'

const mcp = { servers: ['wiki'], rules: { 'wiki.get_page': 'allow' as const } }

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
    const bash = defaultPermissions.bash as Record<string, string>
    expect(bash['git branch']).toBe('allow')
    expect(bash['git branch -a']).toBe('allow')
    expect(bash['git branch *']).toBeUndefined()
  })

  it('sends git --output, command substitution and rg --pre back to the fallback level', () => {
    const bash = defaultPermissions.bash as Record<string, string>
    for (const p of [
      'git *--output*',
      'git *--ext-diff*',
      '*$(*',
      '*`*',
      'rg *--pre*',
      'tree *-o *',
    ]) {
      expect(bash[p]).toBe('ask')
    }
  })

  it('sends redirects and find -delete back to the fallback level', () => {
    const bash = defaultPermissions.bash as Record<string, string>
    const keys = Object.keys(bash)
    expect(bash['*>*']).toBe('ask')
    expect(bash['find *-delete*']).toBe('ask')
    // 内核按顺序匹配、后写的优先，兜底规则要排在白名单后面
    expect(keys.indexOf('*>*')).toBeGreaterThan(keys.indexOf('echo *'))
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

describe('resolvePermissions', () => {
  it('returns the defaults in ask mode without agent or mcp', () => {
    const result = resolvePermissions({ mode: 'ask' })
    expect(result.edit).toBe('allow')
    expect(result.bash).toEqual(defaultPermissions.bash)
    expect(result.kits_ask_user).toBe('allow')
  })

  it('asks for mcp tools whose names look like writes', () => {
    const result = resolvePermissions({ mode: 'ask', mcp })
    expect(result['wiki_create_*']).toBe('ask')
    expect(result.wiki_get_page).toBe('allow')
  })

  it('keeps the user setting for an mcp tool over the name guess', () => {
    const result = resolvePermissions({
      mode: 'ask',
      mcp: { servers: ['wiki'], rules: { 'wiki.update_page': 'allow' } },
    })
    const keys = Object.keys(result)
    expect(result.wiki_update_page).toBe('allow')
    expect(keys.indexOf('wiki_update_page')).toBeGreaterThan(keys.indexOf('wiki_update_*'))
  })

  it('denies edits, non-whitelisted commands and mcp writes in read mode', () => {
    const result = resolvePermissions({
      mode: 'read',
      mcp: { servers: ['wiki'], rules: { 'wiki.update_page': 'allow', 'wiki.sync': 'ask' } },
    })
    expect(result.edit).toBe('deny')
    expect(result.external_directory).toBe('deny')
    expect(result.bash).toMatchObject({ '*': 'deny', 'git diff *': 'allow', '*>*': 'deny' })
    expect(result['wiki_create_*']).toBe('deny')
    expect(result.wiki_update_page).toBe('deny')
    expect(result.wiki_sync).toBe('deny')
  })

  it('allows bash and edit but still asks for outside dirs and mcp writes in auto mode', () => {
    const result = resolvePermissions({ mode: 'auto', mcp })
    expect(result.bash).toEqual({ '*': 'allow' })
    expect(result.edit).toBe('allow')
    expect(result.external_directory).toBe('ask')
    expect(result['wiki_send_*']).toBe('ask')
  })

  it('applies agent deny in every mode', () => {
    for (const mode of ['ask', 'read', 'auto'] as const) {
      const result = resolvePermissions({ mode, agent: { bash: 'deny', edit: 'deny' } })
      expect(result.bash).toBe('deny')
      expect(result.edit).toBe('deny')
    }
  })

  it('applies agent allow and ask only in ask mode', () => {
    const agent = { bash: 'allow' as const, webfetch: 'ask' as const }
    expect(resolvePermissions({ mode: 'ask', agent })).toMatchObject(agent)
    const read = resolvePermissions({ mode: 'read', agent })
    expect(read.webfetch).toBe('deny')
    expect((read.bash as Record<string, string>)['*']).toBe('deny')
  })

  it('merges agent command patterns into the bash rules', () => {
    const result = resolvePermissions({
      mode: 'auto',
      agent: { bash: { 'rm *': 'deny', 'npm *': 'allow' } },
    })
    expect(result.bash).toEqual({ '*': 'allow', 'rm *': 'deny' })
  })

  it('always allows the kits tools, even after an agent wildcard deny', () => {
    const result = resolvePermissions({ mode: 'read', agent: { '*': 'deny' } })
    expect(effectiveLevel(result, 'kits_ask_user', '*')).toBe('allow')
    expect(effectiveLevel(result, 'kits_submit_output', '*')).toBe('allow')
    expect(effectiveLevel(result, 'bash', 'ls')).toBe('deny')
  })

  it('keeps an agent wildcard deny when the agent also adds command patterns', () => {
    for (const mode of ['ask', 'auto'] as const) {
      const result = resolvePermissions({
        mode,
        agent: { '*': 'deny', bash: { 'rm *': 'deny' } },
      })
      expect(effectiveLevel(result, 'bash', 'touch unexpected.txt')).toBe('deny')
      expect(effectiveLevel(result, 'bash', 'rm -rf x')).toBe('deny')
    }
  })

  it('does not lift a broad wildcard allow over a specific deny when merging a wildcard key', () => {
    const result = resolvePermissions({
      mode: 'ask',
      defaults: {},
      agent: { 'b*': 'allow', bash: { 'rm *': 'deny' }, 'ba*': { 'ls *': 'deny' } },
    })
    expect(effectiveLevel(result, 'bash', 'rm -rf example')).toBe('deny')
    expect(effectiveLevel(result, 'bash', 'ls a')).toBe('deny')
    expect(effectiveLevel(result, 'bash', 'pwd')).toBe('allow')
  })

  it('does not allow tools of another server whose name starts with kits_', () => {
    const result = resolvePermissions({
      mode: 'read',
      mcp: { servers: ['kits_wiki'], rules: {} },
      agent: {},
    })
    expect(effectiveLevel(result, 'kits_wiki_delete_page', '*')).toBe('deny')
    expect(effectiveLevel(result, 'kits_remember', '*')).toBe('allow')
  })

  it('lets agent command patterns override an earlier wildcard deny in ask mode', () => {
    const result = resolvePermissions({
      mode: 'ask',
      agent: { '*': 'deny', bash: { 'git *': 'allow' } },
    })
    expect(effectiveLevel(result, 'bash', 'git log')).toBe('allow')
    expect(effectiveLevel(result, 'bash', 'touch x')).toBe('deny')
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

describe('effectiveLevel', () => {
  it('follows wildcard tool keys in order', () => {
    const set = { skill: 'allow' as const, '*': 'deny' as const }
    expect(effectiveLevel(set, 'skill', 'review')).toBe('deny')
    expect(effectiveLevel({ '*': 'deny', skill: { review: 'allow' } }, 'skill', 'review')).toBe(
      'allow',
    )
  })
})
