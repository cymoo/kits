import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSettings } from '@kits/core'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigService } from '../config/config-service'
import { kernelSettingsKey, listAgents, loadSkills } from './kernel-config'

let root: string | undefined
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

function skill(dir: string, name: string, description: string) {
  mkdirSync(path.join(dir, name), { recursive: true })
  writeFileSync(
    path.join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  )
}

describe('loadSkills', () => {
  it('merges builtin, personal and project skills with the project winning on the same name', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-skills-'))
    const builtin = path.join(root, 'builtin')
    const workdir = path.join(root, 'repo')
    const config = new ConfigService({ dir: path.join(root, 'config') })
    skill(path.join(builtin, 'skills'), 'code-review', '内置')
    skill(path.join(builtin, 'skills'), 'explain', '内置')
    skill(config.paths.skills, 'code-review', '个人')
    skill(path.join(workdir, '.agents', 'skills'), 'code-review', '项目')
    skill(path.join(workdir, '.agents', 'skills'), 'api-check', '项目')
    config.updateSettings({ skillsDisabled: ['explain'] })

    const { skills } = loadSkills(config, builtin, workdir)
    const rows = skills
      .map((s) => [s.name, s.source, s.description, s.enabled, s.shadows] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
    expect(rows).toEqual([
      ['api-check', 'project', '项目', true, []],
      ['code-review', 'project', '项目', true, ['builtin', 'personal']],
      ['explain', 'builtin', '内置', false, []],
    ])
    // 不给工作目录就没有项目技能
    expect(
      loadSkills(config, builtin)
        .skills.map((s) => s.source)
        .sort(),
    ).toEqual(['builtin', 'personal'])
  })
})

function agentFile(dir: string, name: string, description: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  )
}

describe('listAgents', () => {
  it('merges builtin, personal and project agents with the project winning on the same name', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-agents-'))
    const builtin = path.join(root, 'builtin')
    const workdir = path.join(root, 'repo')
    const config = new ConfigService({ dir: path.join(root, 'config') })
    agentFile(path.join(builtin, 'agents'), 'assistant', '内置')
    agentFile(config.paths.agents, 'doc-writer', '个人')
    agentFile(path.join(workdir, '.agents', 'agents'), 'doc-writer', '项目')

    const rows = listAgents(config, builtin, workdir)
      .agents.map((a) => [a.name, a.source, a.description, a.shadows] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
    expect(rows).toEqual([
      ['assistant', 'builtin', '内置', []],
      ['doc-writer', 'project', '项目', ['personal']],
    ])
  })

  it('falls back to the code builtin assistant without a resources dir', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-agents-'))
    const config = new ConfigService({ dir: path.join(root, 'config') })
    expect(listAgents(config).agents.map((a) => a.name)).toEqual(['assistant'])
  })
})

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
