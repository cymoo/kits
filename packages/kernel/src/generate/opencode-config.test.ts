import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type AgentProfile,
  agentProfileSchema,
  effectiveLevel,
  parseMcpFile,
  parseSettings,
} from '@kits/core'
import { describe, expect, it } from 'vitest'
import {
  agentPermissions,
  agentSystemPrompt,
  type GenerateResult,
  generateOpencodeConfig,
  kernelAgentOf,
  type OpencodeConfigInput,
  PROJECT_BASE_AGENT,
  skillDenies,
} from './opencode-config'
import { writeGeneratedFiles } from './write'

const settings = parseSettings({
  gateways: [
    {
      id: 'corp',
      name: '公司网关',
      baseUrl: 'https://gw.example.internal/v1',
      models: [{ id: 'deepseek-v4-pro' }, { id: 'reasoner-pro', toolCall: false }],
    },
    { id: 'backup', baseUrl: 'https://gw2.example.internal/v1', models: [{ id: 'qwen' }] },
    { id: 'off', enabled: false, baseUrl: '', models: [] },
  ],
  defaultModel: 'corp/deepseek-v4-pro',
})

function agent(fields: Partial<AgentProfile> & { name: string }): AgentProfile {
  return agentProfileSchema.parse({ source: 'personal', ...fields })
}

function input(overrides: Partial<OpencodeConfigInput> = {}): OpencodeConfigInput {
  return {
    settings,
    agents: [agent({ name: 'assistant', source: 'builtin' })],
    mcp: parseMcpFile({
      mcpServers: {
        wiki: { url: 'https://wiki.local/mcp', headers: { Authorization: 'Bearer ${WIKI_TOKEN}' } },
        fs: { command: 'npx', args: ['-y', 'fs-server'], env: { ROOT: '/data' } },
      },
      permissions: { 'wiki.get_page': 'allow' },
    }),
    skills: [{ name: 'review', description: '', source: 'builtin', dir: '/res/skills/review' }],
    instructions: ['/home/me/.kits/memory.md'],
    gatewayKeys: { corp: 'sk-corp', backup: 'sk-backup' },
    lookupVar: (name) => (name === 'WIKI_TOKEN' ? 'wiki-secret' : undefined),
    kitsTools: { url: 'http://127.0.0.1:5000/mcp', token: 'tok' },
    ...overrides,
  }
}

function ok(result: GenerateResult) {
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result
}

function config(overrides: Partial<OpencodeConfigInput> = {}): Record<string, any> {
  return ok(generateOpencodeConfig(input(overrides))).config
}

describe('generateOpencodeConfig', () => {
  it('maps every enabled gateway to an openai-compatible provider with the key in env', () => {
    const result = ok(generateOpencodeConfig(input()))
    expect(result.config.provider).toEqual({
      corp: {
        npm: '@ai-sdk/openai-compatible',
        name: '公司网关',
        options: { baseURL: 'https://gw.example.internal/v1', apiKey: '{env:KITS_GW_CORP_KEY}' },
        models: {
          'deepseek-v4-pro': {
            name: 'deepseek-v4-pro',
            tool_call: true,
            limit: { context: 128_000, output: 32_000 },
          },
          'reasoner-pro': {
            name: 'reasoner-pro',
            tool_call: false,
            limit: { context: 128_000, output: 32_000 },
          },
        },
      },
      backup: expect.objectContaining({
        options: { baseURL: 'https://gw2.example.internal/v1', apiKey: '{env:KITS_GW_BACKUP_KEY}' },
      }),
    })
    expect(result.config.enabled_providers).toEqual(['corp', 'backup'])
    expect(result.files.env).toMatchObject({
      KITS_GW_CORP_KEY: 'sk-corp',
      KITS_GW_BACKUP_KEY: 'sk-backup',
    })
  })

  it('never writes a secret into the config file', () => {
    const result = ok(generateOpencodeConfig(input()))
    const text = result.files.files.map((f) => f.content).join('\n')
    for (const secret of ['sk-corp', 'sk-backup', 'wiki-secret', 'tok']) {
      expect(text).not.toContain(`"${secret}"`)
      expect(text).not.toContain(` ${secret}"`)
    }
  })

  it('writes the plugin that adds a description to the bash tool', () => {
    const { files } = ok(generateOpencodeConfig(input())).files
    const plugin = files.find((f) => f.path === 'plugins/kits-describe-bash.js')
    expect(plugin?.content).toContain("'tool.definition'")
  })

  it('keeps the output limit below the context window of a small model', () => {
    const c = config({
      settings: parseSettings({
        gateways: [
          {
            id: 'corp',
            baseUrl: 'https://gw.example.internal/v1',
            models: [{ id: 'm', contextWindow: 8_000 }],
          },
        ],
        defaultModel: 'corp/m',
      }),
    })
    expect(c.provider.corp.models.m.limit).toEqual({ context: 8_000, output: 2_000 })
  })

  it('writes the default model and turns off network features', () => {
    expect(config()).toMatchObject({
      model: 'corp/deepseek-v4-pro',
      autoupdate: false,
      share: 'disabled',
      lsp: false,
      formatter: false,
    })
  })

  it('maps stdio and http mcp servers and routes ${VAR} through env', () => {
    const result = ok(generateOpencodeConfig(input()))
    expect(result.config.mcp).toMatchObject({
      wiki: {
        type: 'remote',
        url: 'https://wiki.local/mcp',
        headers: { Authorization: 'Bearer {env:KITS_MCP_WIKI_TOKEN}' },
        enabled: true,
        oauth: false,
      },
      fs: { type: 'local', command: ['npx', '-y', 'fs-server'], environment: { ROOT: '/data' } },
    })
    expect(result.files.env.KITS_MCP_WIKI_TOKEN).toBe('wiki-secret')
  })

  it('mounts the kits tool server with a bearer token from env', () => {
    const result = ok(generateOpencodeConfig(input()))
    expect((result.config.mcp as Record<string, unknown>).kits).toEqual({
      type: 'remote',
      url: 'http://127.0.0.1:5000/mcp',
      headers: { Authorization: 'Bearer {env:KITS_TOOLS_TOKEN}' },
      enabled: true,
      oauth: false,
      // 阻塞提问要等人回答，内核默认 60 s 就掐断
      timeout: 24 * 60 * 60 * 1000,
    })
    expect(result.files.env.KITS_TOOLS_TOKEN).toBe('tok')
  })

  it('lists skill dirs and memory files for the kernel to load', () => {
    expect(config()).toMatchObject({
      skills: { paths: ['/res/skills/review'] },
      instructions: ['/home/me/.kits/memory.md'],
    })
  })

  it('prefixes agent names and picks assistant as the default agent', () => {
    const c = config({ agents: [agent({ name: 'api-reviewer' }), agent({ name: 'assistant' })] })
    expect(Object.keys(c.agent)).toEqual(['kits-api-reviewer', 'kits-assistant', 'kits-_project'])
    expect(c.default_agent).toBe('kits-assistant')
  })

  it('turns a tool allow list into disabled tools', () => {
    const c = config({ agents: [agent({ name: 'r', tools: ['read', 'grep', 'glob'] })] })
    const tools = c.agent['kits-r'].tools
    expect(tools).toMatchObject({ bash: false, edit: false, write: false, webfetch: false })
    expect(tools.read).toBeUndefined()
  })

  it('keeps write and apply_patch when edit is allowed', () => {
    const c = config({ agents: [agent({ name: 'w', tools: ['read', 'edit'] })] })
    const tools = c.agent['kits-w'].tools
    expect(tools.write).toBeUndefined()
    expect(tools.apply_patch).toBeUndefined()
    expect(tools.bash).toBe(false)
  })

  it('disables mcp servers that are not in the agent mcp list', () => {
    const c = config({ agents: [agent({ name: 'a', mcp: ['wiki'] })] })
    expect(c.agent['kits-a'].tools).toMatchObject({ 'fs_*': false })
    expect(c.agent['kits-a'].tools['wiki_*']).toBeUndefined()
  })

  it('offers submit_output only to agents with an output schema', () => {
    const c = config({
      agents: [
        agent({ name: 'plain' }),
        agent({ name: 'cases', outputSchema: { type: 'object' } }),
      ],
    })
    expect(c.agent['kits-plain'].tools.kits_submit_output).toBe(false)
    expect(c.agent['kits-cases'].tools).toBeUndefined()
  })

  it('writes agent permission overrides on top of the defaults', () => {
    const c = config({
      agents: [agent({ name: 'r', permissions: { bash: 'deny', edit: 'deny' } })],
    })
    // Agent 那一份只放 Agent 自己的规则，默认值在全局 permission 里，内核按“全局 → Agent”的顺序接起来
    expect(c.agent['kits-r'].permission).toMatchObject({ bash: 'deny', edit: 'deny' })
    expect(c.agent['kits-r'].permission.read).toBeUndefined()
    expect(c.permission.bash).toMatchObject({ '*': 'ask', 'git status': 'allow' })
  })

  it('keeps agent prompts out of the config so the kernel prompt stays in place', () => {
    const c = config({ agents: [agent({ name: 'b', prompt: '你是 b' })] })
    expect(c.agent['kits-b'].prompt).toBeUndefined()
  })

  it('reports an empty gateway url against the gateway', () => {
    const result = generateOpencodeConfig(
      input({
        settings: parseSettings({
          gateways: [{ id: 'corp', models: [{ id: 'm' }] }],
          defaultModel: 'corp/m',
        }),
      }),
    )
    expect(!result.ok && result.problems).toEqual([
      { section: 'model', target: 'corp', message: '网关地址为空' },
    ])
  })

  it('accepts a gateway without an api key and writes a placeholder', () => {
    const result = ok(generateOpencodeConfig(input({ gatewayKeys: { backup: 'sk-backup' } })))
    const provider = result.config.provider as Record<string, { options: { apiKey: string } }>
    expect(provider.corp?.options.apiKey).toBe('kits-no-key')
    expect(result.files.env.KITS_GW_CORP_KEY).toBeUndefined()
  })

  it('reports a default model that is not on an enabled gateway', () => {
    const result = generateOpencodeConfig(
      input({ settings: { ...settings, defaultModel: 'off/m' } }),
    )
    expect(!result.ok && result.problems.map((p) => p.target)).toEqual(['defaultModel'])
  })

  it('reports an agent model that does not exist', () => {
    const result = generateOpencodeConfig(
      input({ agents: [agent({ name: 'a', model: 'corp/nope' })] }),
    )
    expect(!result.ok && result.problems).toEqual([
      { section: 'agent', target: 'a', message: '模型 corp/nope 不在任何启用的网关里' },
    ])
  })

  it('reports an invalid output schema', () => {
    const result = generateOpencodeConfig(
      input({ agents: [agent({ name: 'a', outputSchema: { type: 'thing' } })] }),
    )
    expect(!result.ok && result.problems[0]?.section).toBe('agent')
  })

  it('reports a missing mcp variable only for enabled servers', () => {
    const mcp = parseMcpFile({
      mcpServers: {
        on: { url: 'https://a.local/mcp', headers: { A: '${MISSING}' } },
        off: { url: 'https://b.local/mcp', headers: { A: '${MISSING}' } },
      },
      enabled: { off: false },
    })
    const result = generateOpencodeConfig(input({ mcp }))
    expect(!result.ok && result.problems).toEqual([
      { section: 'mcp', target: 'on', message: '找不到变量 MISSING' },
    ])
  })

  it('reports mcp variables that collide after turning into env names', () => {
    const mcp = parseMcpFile({
      mcpServers: {
        a: { url: 'https://a.local/mcp', headers: { A: '${TOKEN}' } },
        b: { url: 'https://b.local/mcp', headers: { B: '${token}' } },
      },
    })
    const result = generateOpencodeConfig(input({ mcp, lookupVar: (n) => `value-of-${n}` }))
    expect(!result.ok && result.problems).toEqual([
      { section: 'mcp', target: 'b', message: '变量 token 和 TOKEN 只差大小写或符号，换一个名字' },
    ])
  })

  it('ignores variable collisions in disabled servers', () => {
    const mcp = parseMcpFile({
      mcpServers: {
        off: { url: 'https://b.local/mcp', headers: { B: '${token}' } },
        on: { url: 'https://a.local/mcp', headers: { A: '${TOKEN}' } },
      },
      enabled: { off: false },
    })
    const result = ok(generateOpencodeConfig(input({ mcp, lookupVar: () => 'v' })))
    expect((result.config.mcp as any).off.headers.B).toBe('{env:KITS_MCP_TOKEN}')
    expect(result.files.env.KITS_MCP_TOKEN).toBe('v')
  })

  it('reserves the kits mcp server name and the kits_ prefix', () => {
    for (const name of ['kits', 'kits_wiki']) {
      const mcp = parseMcpFile({ mcpServers: { [name]: { url: 'https://a.local/mcp' } } })
      const result = generateOpencodeConfig(input({ mcp }))
      expect(!result.ok && result.problems[0]?.target).toBe(name)
    }
  })
})

describe('agentPermissions', () => {
  const mcp = parseMcpFile({ mcpServers: {} })
  const level = (a: AgentProfile, mode: 'ask' | 'read' | 'auto', tool: string, arg = '*') =>
    effectiveLevel(agentPermissions(a, mode, mcp), tool, arg)

  it('denies built-in tools outside the agent tool list in every mode', () => {
    const a = agent({
      name: 'a',
      tools: ['read', 'grep', 'glob', 'edit'],
      permissions: { bash: 'allow' },
    })
    for (const mode of ['ask', 'auto'] as const) {
      expect(level(a, mode, 'bash', 'ls')).toBe('deny')
      expect(level(a, mode, 'webfetch')).toBe('deny')
      expect(level(a, mode, 'task')).toBe('deny')
      expect(level(a, mode, 'read')).toBe('allow')
      expect(level(a, mode, 'edit')).toBe('allow')
    }
  })

  it('denies mcp servers outside the agent mcp list in every mode', () => {
    const servers = parseMcpFile({
      mcpServers: {
        wiki: { url: 'https://wiki.local/mcp' },
        req: { url: 'https://req.local/mcp' },
      },
    })
    const a = agent({ name: 'a', mcp: ['req'] })
    for (const mode of ['ask', 'auto'] as const) {
      const rules = agentPermissions(a, mode, servers)
      expect(effectiveLevel(rules, 'wiki_get_page', '*')).toBe('deny')
      expect(effectiveLevel(rules, 'req_get_requirement', '*')).not.toBe('deny')
    }
  })

  it('limits the skill tool to the agent skill list in every mode', () => {
    const a = agent({ name: 'a', skills: ['review'] })
    for (const mode of ['ask', 'read', 'auto'] as const) {
      expect(level(a, mode, 'skill', 'review')).toBe('allow')
      expect(level(a, mode, 'skill', 'other')).toBe('deny')
    }
  })

  it('keeps a per-skill deny or ask inside the skill list', () => {
    const a = agent({
      name: 'a',
      skills: ['review', 'doc'],
      permissions: { skill: { review: 'deny', doc: 'ask' } },
    })
    expect(level(a, 'ask', 'skill', 'review')).toBe('deny')
    expect(level(a, 'ask', 'skill', 'doc')).toBe('ask')
    // read 模式下 ask 不生效，回到默认的 allow；deny 永远生效
    expect(level(a, 'read', 'skill', 'review')).toBe('deny')
    expect(level(a, 'read', 'skill', 'doc')).toBe('allow')
  })

  it('keeps an agent wildcard deny over the skill list', () => {
    const a = agent({ name: 'a', skills: ['review'], permissions: { '*': 'deny' } })
    for (const mode of ['ask', 'read', 'auto'] as const) {
      expect(level(a, mode, 'skill', 'review')).toBe('deny')
    }
  })

  it('writes the agent part of the rules into the config without reordering the agent keys', () => {
    const c = config({
      agents: [
        agent({
          name: 'r',
          tools: ['read', 'skill'],
          skills: ['review'],
          permissions: { 'wiki_*_page': 'allow', 'wiki_create_*': { '*': 'deny' } },
        }),
      ],
    })
    const keys = Object.keys(c.agent['kits-r'].permission)
    expect(keys.slice(0, 2)).toEqual(['wiki_*_page', 'wiki_create_*'])
    expect(c.agent['kits-r'].permission).toMatchObject({
      bash: 'deny',
      skill: { '*': 'deny', review: 'allow' },
      kits_ask_user: 'allow',
    })
  })
})

describe('writeGeneratedFiles', () => {
  it('writes files under the config dir', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kits-gen-'))
    try {
      await writeGeneratedFiles(dir, { files: [{ path: 'a/b.json', content: '{}' }], env: {} })
      expect(readFileSync(path.join(dir, 'a', 'b.json'), 'utf8')).toBe('{}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a path that leaves the config dir', async () => {
    await expect(
      writeGeneratedFiles(os.tmpdir(), { files: [{ path: '../x.json', content: '' }], env: {} }),
    ).rejects.toThrow()
  })
})

describe('skill permissions', () => {
  it('denies the skills turned off in settings and the kernel builtin one', () => {
    const permission = config({ disabledSkills: ['code-review'] }).permission as {
      skill: Record<string, string>
    }
    expect(permission.skill).toEqual({
      '*': 'allow',
      'customize-opencode': 'deny',
      'code-review': 'deny',
    })
  })

  it('gives sessions the same denies to append after their own rules', () => {
    expect(skillDenies(['code-review'])).toEqual([
      { tool: 'skill', pattern: 'customize-opencode', level: 'deny' },
      { tool: 'skill', pattern: 'code-review', level: 'deny' },
    ])
  })
})

describe('agent prompts and project agents', () => {
  it('runs project agents on the shared base agent', () => {
    expect(kernelAgentOf(agent({ name: 'api-reviewer', source: 'project' }))).toBe(
      PROJECT_BASE_AGENT,
    )
    expect(kernelAgentOf(agent({ name: 'doc-writer' }))).toBe('doc-writer')
  })

  it('writes the base agent into the config without a prompt', () => {
    const c = ok(generateOpencodeConfig(input())).config as { agent: Record<string, object> }
    expect(c.agent['kits-_project']).toEqual({
      mode: 'primary',
      description: expect.any(String),
    })
  })

  it('carries the prompt and the output format in the system prompt', () => {
    const a = agent({ name: 'r', prompt: '对照文档找不一致', outputSchema: { type: 'object' } })
    const system = agentSystemPrompt(a)
    expect(system.startsWith('对照文档找不一致\n\n## 输出格式')).toBe(true)
    expect(system).toContain('kits_submit_output')
    expect(system).toContain('"type": "object"')
  })
})
