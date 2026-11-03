import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMcpFile, parseSettings } from '@kits/core'
import type { AgentDraft } from '@kits/core/ipc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../config/config-service'
import { AgentService } from './agent-service'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup() {
  root = mkdtempSync(path.join(os.tmpdir(), 'kits-agent-svc-'))
  const config = new ConfigService({ dir: path.join(root, 'config') })
  const { gateways } = parseSettings({
    gateways: [{ id: 'corp', baseUrl: 'https://gw/v1', models: [{ id: 'm' }] }],
  })
  config.updateSettings({ gateways })
  const workdir = path.join(root, 'repo')
  mkdirSync(workdir, { recursive: true })
  const onChanged = vi.fn()
  const trash = vi.fn(async (file: string) => rmSync(file))
  const service = new AgentService({
    config,
    loadMcp: () => parseMcpFile({ mcpServers: { wiki: { url: 'https://wiki/mcp' } } }),
    onChanged,
    trash,
    openPath: async () => {},
  })
  return { config, service, workdir, onChanged, trash }
}

const draft = (patch: Partial<AgentDraft> = {}): AgentDraft => ({
  name: 'doc-writer',
  description: '给模块补文档',
  permissions: { bash: 'deny' },
  prompt: '不改代码。',
  ...patch,
})

describe('AgentService', () => {
  it('writes a personal agent as markdown and restarts the kernel', () => {
    const { service, config, onChanged } = setup()
    const saved = service.save({ source: 'personal', draft: draft() })
    const text = readFileSync(path.join(config.paths.agents, 'doc-writer.md'), 'utf8')
    expect(text).toContain('description: 给模块补文档')
    expect(text).toContain('bash: deny')
    expect(text.trimEnd().endsWith('不改代码。')).toBe(true)
    expect(saved).toMatchObject({ name: 'doc-writer', source: 'personal' })
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('writes a project agent under the workdir without restarting the kernel', () => {
    const { service, workdir, onChanged } = setup()
    service.save({ source: 'project', workdir, draft: draft() })
    expect(existsSync(path.join(workdir, '.agents', 'agents', 'doc-writer.md'))).toBe(true)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('keeps frontmatter fields it does not know when saving over a file', () => {
    const { service, config } = setup()
    mkdirSync(config.paths.agents, { recursive: true })
    const file = path.join(config.paths.agents, 'doc-writer.md')
    writeFileSync(file, '---\nname: doc-writer\ncolor: blue\n---\n旧的\n')
    service.save({ source: 'personal', original: 'doc-writer', draft: draft() })
    expect(readFileSync(file, 'utf8')).toContain('color: blue')
  })

  it('renames by writing the new file and removing the old one', () => {
    const { service, config } = setup()
    service.save({ source: 'personal', draft: draft() })
    service.save({ source: 'personal', original: 'doc-writer', draft: draft({ name: 'docs' }) })
    expect(existsSync(path.join(config.paths.agents, 'docs.md'))).toBe(true)
    expect(existsSync(path.join(config.paths.agents, 'doc-writer.md'))).toBe(false)
  })

  it('refuses a name that another agent already uses', () => {
    const { service } = setup()
    service.save({ source: 'personal', draft: draft() })
    expect(() => service.save({ source: 'personal', draft: draft() })).toThrow(/已经有/)
  })

  it('refuses a model that is not on an enabled gateway', () => {
    const { service } = setup()
    expect(() => service.save({ source: 'personal', draft: draft({ model: 'corp/x' }) })).toThrow(
      /corp\/x/,
    )
  })

  it('restores the file when the output format it points to cannot be read', () => {
    const { service, config } = setup()
    service.save({ source: 'personal', draft: draft() })
    expect(() =>
      service.save({
        source: 'personal',
        original: 'doc-writer',
        draft: draft({ output: 'missing.json' }),
      }),
    ).toThrow(/missing.json/)
    expect(readFileSync(path.join(config.paths.agents, 'doc-writer.md'), 'utf8')).not.toContain(
      'missing.json',
    )
  })

  it('creates a starter output format next to the agent and points to it', () => {
    const { service, config } = setup()
    service.save({ source: 'personal', draft: draft() })
    const view = service.createOutput({ name: 'doc-writer', source: 'personal' })
    expect(view).toMatchObject({ output: 'doc-writer.schema.json', hasOutputSchema: true })
    expect(existsSync(path.join(config.paths.agents, 'doc-writer.schema.json'))).toBe(true)
  })

  it('moves a removed agent to the trash', async () => {
    const { service, trash } = setup()
    const saved = service.save({ source: 'personal', draft: draft() })
    await service.remove({ name: 'doc-writer', source: 'personal' })
    expect(trash).toHaveBeenCalledWith(saved.path)
  })

  it('refuses to change the builtin assistant', () => {
    const { service } = setup()
    expect(() =>
      service.save({ source: 'builtin' as 'personal', draft: draft({ name: 'assistant' }) }),
    ).toThrow(/内置/)
  })

  it('previews a project agent as the base agent with its prompt and session rules', () => {
    const { service } = setup()
    const preview = JSON.parse(
      service.preview({ source: 'project', draft: draft({ mcp: [] }) }),
    ) as { agent: string; system: string; permission: { permission: string; action: string }[] }
    expect(preview.agent).toBe('kits-_project')
    expect(preview.system).toBe('不改代码。')
    expect(preview.permission).toContainEqual({
      permission: 'wiki_*',
      pattern: '*',
      action: 'deny',
    })
  })
})
