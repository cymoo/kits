import { describe, expect, it } from 'vitest'
import { mergeBySource, parseAgentMarkdown, serializeAgentMarkdown } from './agent'

const reviewer = `---
name: api-reviewer
description: 对照文档和实现，列出不一致
model: corp/reasoner-pro
tools: [read, grep, glob]
permissions: { bash: deny, edit: deny }
skills: [repo-conventions]
mcp: [req-platform]
output: api-findings.schema.json
---
你是接口评审。
`

describe('parseAgentMarkdown', () => {
  it('reads frontmatter fields and uses the body as the prompt', () => {
    const agent = parseAgentMarkdown(reviewer, { source: 'project', path: '/w/a.md' })
    expect(agent).toMatchObject({
      name: 'api-reviewer',
      model: 'corp/reasoner-pro',
      tools: ['read', 'grep', 'glob'],
      permissions: { bash: 'deny', edit: 'deny' },
      skills: ['repo-conventions'],
      mcp: ['req-platform'],
      output: 'api-findings.schema.json',
      prompt: '你是接口评审。',
      source: 'project',
      path: '/w/a.md',
    })
  })

  it('treats tools: all and missing lists as unrestricted', () => {
    const agent = parseAgentMarkdown('---\nname: a\ntools: all\n---\nhi', { source: 'personal' })
    expect(agent.tools).toBeUndefined()
    expect(agent.skills).toBeUndefined()
    expect(agent.mcp).toBeUndefined()
  })

  it('accepts a comma separated tool list', () => {
    const agent = parseAgentMarkdown('---\nname: a\ntools: read, grep\n---\n', {
      source: 'personal',
    })
    expect(agent.tools).toEqual(['read', 'grep'])
  })

  it('falls back to the file name when name is missing', () => {
    const agent = parseAgentMarkdown('只有正文', { source: 'personal', fallbackName: 'notes' })
    expect(agent.name).toBe('notes')
    expect(agent.prompt).toBe('只有正文')
  })

  it('rejects a name that cannot be used as a file name', () => {
    expect(() => parseAgentMarkdown('---\nname: a/b\n---\n', { source: 'personal' })).toThrow()
  })

  it('rejects an unknown permission level', () => {
    const text = '---\nname: a\npermissions: { bash: maybe }\n---\n'
    expect(() => parseAgentMarkdown(text, { source: 'personal' })).toThrow()
  })
})

describe('serializeAgentMarkdown', () => {
  it('round-trips through parseAgentMarkdown', () => {
    const agent = parseAgentMarkdown(reviewer, { source: 'project' })
    const again = parseAgentMarkdown(serializeAgentMarkdown(agent), { source: 'project' })
    expect(again).toEqual(agent)
  })

  it('leaves out fields that use the defaults', () => {
    const agent = parseAgentMarkdown('---\nname: a\n---\nhi', { source: 'personal' })
    expect(serializeAgentMarkdown(agent)).toBe('---\nname: a\n---\n\nhi\n')
  })
})

describe('mergeBySource', () => {
  it('lets a later source override an earlier one with the same name', () => {
    const merged = mergeBySource(
      [{ name: 'a', source: 'builtin' as const, v: 1 }],
      [{ name: 'a', source: 'personal' as const, v: 2 }],
      [
        { name: 'a', source: 'project' as const, v: 3 },
        { name: 'b', source: 'project' as const, v: 4 },
      ],
    )
    expect(merged.map((m) => [m.name, m.v, m.shadows])).toEqual([
      ['a', 3, ['builtin', 'personal']],
      ['b', 4, []],
    ])
  })
})
