import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadAgentsDir, loadSkillsDir } from './files'
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { resolveSkills } from './skill'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'kits-core-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(rel: string, text: string): void {
  const file = path.join(root, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

describe('loadAgentsDir', () => {
  it('reads the output schema file relative to the agent file', () => {
    write('agents/a.md', '---\nname: a\noutput: out.schema.json\n---\nhi')
    write('agents/out.schema.json', JSON.stringify({ type: 'object', required: ['x'] }))
    const { items, errors } = loadAgentsDir(path.join(root, 'agents'), 'personal')
    expect(errors).toEqual([])
    expect(items[0]?.outputSchema).toEqual({ type: 'object', required: ['x'] })
  })

  it('collects a broken file as an error and keeps the others', () => {
    write('agents/good.md', '---\nname: good\n---\n')
    write('agents/bad.md', '---\nname: bad\noutput: missing.json\n---\n')
    const { items, errors } = loadAgentsDir(path.join(root, 'agents'), 'personal')
    expect(items.map((a) => a.name)).toEqual(['good'])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('missing.json')
  })

  it('reports an output schema with an unknown type', () => {
    write('agents/a.md', '---\nname: a\noutput: o.json\n---\n')
    write('agents/o.json', JSON.stringify({ type: 'obj' }))
    const { errors } = loadAgentsDir(path.join(root, 'agents'), 'personal')
    expect(errors[0]?.message).toContain('type')
  })

  it('returns nothing for a missing dir', () => {
    expect(loadAgentsDir(path.join(root, 'nope'), 'project')).toEqual({ items: [], errors: [] })
  })
})

describe('loadSkillsDir', () => {
  it('finds one skill per sub dir with a SKILL.md', () => {
    write('skills/review/SKILL.md', '---\nname: review\ndescription: 审代码\n---\nbody')
    write('skills/notes.txt', 'x')
    write('skills/empty/readme.md', 'x')
    const { items } = loadSkillsDir(path.join(root, 'skills'), 'builtin')
    expect(items).toEqual([
      {
        name: 'review',
        description: '审代码',
        source: 'builtin',
        dir: path.join(root, 'skills', 'review'),
      },
    ])
  })
})

describe('resolveSkills', () => {
  it('marks disabled skills and lets project skills shadow builtin ones', () => {
    const builtin = [{ name: 'review', description: 'b', source: 'builtin' as const, dir: '/b' }]
    const project = [{ name: 'review', description: 'p', source: 'project' as const, dir: '/p' }]
    const personal = [{ name: 'doc-zh', description: '', source: 'personal' as const, dir: '/d' }]
    const resolved = resolveSkills([builtin, personal, project], ['doc-zh'])
    expect(resolved.map((s) => [s.name, s.dir, s.enabled, s.shadows])).toEqual([
      ['doc-zh', '/d', false, []],
      ['review', '/p', true, ['builtin']],
    ])
  })
})

describe('parseFrontmatter', () => {
  it('returns the whole text as body when there is no frontmatter', () => {
    expect(parseFrontmatter('# hi')).toEqual({ data: {}, body: '# hi' })
  })

  it('handles CRLF line endings and a BOM', () => {
    expect(parseFrontmatter('﻿---\r\nname: a\r\n---\r\nbody')).toEqual({
      data: { name: 'a' },
      body: 'body',
    })
  })

  it('reads an empty frontmatter written by stringifyFrontmatter', () => {
    const text = stringifyFrontmatter({}, '正文')
    expect(text).toBe('---\n---\n\n正文')
    expect(parseFrontmatter(text)).toEqual({ data: {}, body: '正文' })
  })

  it('rejects a frontmatter that is a list', () => {
    expect(() => parseFrontmatter('---\n- a\n---\n')).toThrow()
  })
})
