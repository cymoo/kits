import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agentProfileSchema, parseMcpFile, parseSettings } from '@kits/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect } from '../dialects/opencode'
import type { SpawnedKernel } from '../kernel'
import { generateOpencodeConfig } from './opencode-config'

// 契约测试：生成的 opencode.json 交给真实的 opencode serve，读回 /config、/agent、/skill、/mcp，
// 确认 1.19.5 认这些字段（phase1-implementation 第 9 节的前两条风险）。不调模型。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

describe.skipIf(!binary)('generated opencode config', () => {
  let root: string
  let workdir: string
  let kernel: SpawnedKernel
  const get = async (route: string) => {
    const res = await fetch(`${kernel.baseUrl}${route}?directory=${encodeURIComponent(workdir)}`, {
      headers: kernel.headers,
    })
    expect(res.status).toBe(200)
    return (await res.json()) as any
  }

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-contract-'))
    workdir = path.join(root, 'work')
    mkdirSync(workdir)
    // OpenCode 自带 /review 命令，技能名用别的，免得命令列表里撞名
    const skillDir = path.join(root, 'skills', 'api-check')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: api-check\ndescription: 核对接口\n---\n按清单核对。\n',
    )
    const memory = path.join(root, 'memory.md')
    writeFileSync(memory, '- 测试命令是 pnpm test <!-- manual 2026-11-04 -->\n')

    const result = generateOpencodeConfig({
      // 两个网关：PoC 只配过一个，这里确认多个 provider 各自的 baseURL 都能配
      settings: parseSettings({
        gateways: [
          {
            id: 'corp',
            baseUrl: 'http://127.0.0.1:9/v1',
            models: [{ id: 'm1', contextWindow: 1_048_576 }],
          },
          { id: 'backup', baseUrl: 'http://127.0.0.1:10/v1', models: [{ id: 'm2' }] },
        ],
        defaultModel: 'corp/m1',
      }),
      agents: [
        agentProfileSchema.parse({ name: 'assistant', source: 'builtin' }),
        agentProfileSchema.parse({
          name: 'api-reviewer',
          tools: ['read', 'grep', 'glob'],
          permissions: { bash: 'deny' },
          skills: ['api-check'],
          prompt: '你是接口评审。',
        }),
      ],
      mcp: parseMcpFile({
        mcpServers: { wiki: { url: 'http://127.0.0.1:11/mcp', headers: { A: '${WIKI}' } } },
        enabled: { wiki: false },
      }),
      skills: [{ name: 'api-check', description: '核对接口', source: 'builtin', dir: skillDir }],
      instructions: [memory],
      gatewayKeys: { corp: 'k1', backup: 'k2' },
      lookupVar: () => 'w',
      kitsTools: { url: 'http://127.0.0.1:12/mcp', token: 't' },
    })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    const configDir = path.join(root, 'config')
    await opencodeDialect.writeConfig(configDir, result.files)
    kernel = await opencodeDialect.spawn({
      binary: binary ?? '',
      configDir,
      dataDir: path.join(root, 'data'),
      env: result.files.env,
    })
  }, 60_000)

  afterAll(async () => {
    await kernel?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves both gateway providers with keys from env', async () => {
    const config = await get('/config')
    expect(config.provider.corp.options).toEqual({ baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k1' })
    expect(config.provider.backup.options).toEqual({
      baseURL: 'http://127.0.0.1:10/v1',
      apiKey: 'k2',
    })
    expect(config.model).toBe('corp/m1')
    expect(config.instructions).toHaveLength(1)
  })

  it('gives the kernel the context window of a model', async () => {
    const { providers } = await get('/config/providers')
    const corp = providers.find((p: { id: string }) => p.id === 'corp')
    expect(corp.models.m1.limit).toMatchObject({ context: 1_048_576, output: 32_000 })
  })

  it('lists the kits agents with their permission rules', async () => {
    const agents: any[] = await get('/agent')
    const reviewer = agents.find((a) => a.name === 'kits-api-reviewer')
    // 提示词不进配置（随消息的 system 带上），内核自带的系统提示词保留
    expect(reviewer).toMatchObject({ mode: 'primary' })
    expect(reviewer.prompt ?? undefined).toBeUndefined()
    const rules = reviewer.permission as { permission: string; pattern: string; action: string }[]
    const last = (perm: string) =>
      rules.filter((r) => r.permission === perm && r.pattern === '*').at(-1)
    expect(last('bash')?.action).toBe('deny')
    // 工具允许列表外的 edit：tools 只管工具列表，权限里也要写 deny，不然 Agent 的 edit: allow 还在
    expect(last('edit')?.action).toBe('deny')
    expect(agents.some((a) => a.name === 'kits-assistant')).toBe(true)
    expect(agents.some((a) => a.name === 'kits-_project')).toBe(true)
  })

  it('discovers the skill from the listed dir and registers it as a command', async () => {
    const skills: any[] = await get('/skill')
    expect(skills.map((s) => s.name)).toContain('api-check')
    const commands: any[] = await get('/command')
    expect(commands.find((c) => c.name === 'api-check')?.source).toBe('skill')
  })

  it('knows the kits and wiki mcp servers', async () => {
    const mcp = await get('/mcp')
    expect(Object.keys(mcp).sort()).toEqual(['kits', 'wiki'])
    expect(mcp.wiki.status).toBe('disabled')
  })
})
