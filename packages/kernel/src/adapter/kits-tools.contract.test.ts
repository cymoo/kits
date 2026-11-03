import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  agentProfileSchema,
  builtinAssistant,
  createKitsToolServer,
  type KernelEvent,
  type KitsToolHandlers,
  type KitsToolHttpServer,
  parseMcpFile,
  parseSettings,
  startKitsToolHttpServer,
  ToolCallRegistry,
} from '@kits/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect } from '../dialects/opencode'
import { agentPermissions, generateOpencodeConfig } from '../generate/opencode-config'
import type { KernelSession } from '../kernel'
import { MOCK_MODEL_ID, type MockModel, startMockModel } from '../testing/mock-model'
import { OpencodeFamilyKernel } from './opencode-family'

// 契约测试（phase1-implementation 5.3 节）：真实 opencode serve 经 HTTP MCP 调 kits 工具。
// 覆盖：token 鉴权能连上；按 tool-start 登记的参数把调用对到会话；阻塞提问挂着时内核不掐断；
// submit_output 按会话的 Agent 校验。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

const BLOCK_MS = 8_000
const mcp = parseMcpFile({})
const cases = agentProfileSchema.parse({
  name: 'cases',
  outputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
})

describe.skipIf(!binary)('kits tools called by opencode serve', () => {
  let root: string
  let workdir: string
  let kernel: OpencodeFamilyKernel
  let tools: KitsToolHttpServer
  const registry = new ToolCallRegistry()
  const mocks: Record<string, MockModel> = {}
  const calls: { tool: string; sessionId: string | undefined; input: unknown }[] = []

  const handlers: KitsToolHandlers = {
    askUser: async (input, ctx) => {
      calls.push({ tool: 'ask_user', sessionId: ctx.sessionId, input })
      if (!input.blocking) {
        return { answered: false, ...(input.assumption ? { assumption: input.assumption } : {}) }
      }
      await new Promise((r) => setTimeout(r, BLOCK_MS))
      return { answered: true, answer: '用预发环境' }
    },
    outputSchema: (ctx) =>
      ctx.sessionId && sessionsWithSchema.has(ctx.sessionId) ? cases.outputSchema : undefined,
    onOutput: async (output, ctx) => {
      calls.push({ tool: 'submit_output', sessionId: ctx.sessionId, input: output })
    },
    remember: async (input, ctx) => {
      calls.push({ tool: 'remember', sessionId: ctx.sessionId, input })
    },
  }
  const sessionsWithSchema = new Set<string>()

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-tools-'))
    workdir = path.join(root, 'work')
    mkdirSync(workdir)
    tools = await startKitsToolHttpServer({
      createServer: () =>
        createKitsToolServer({
          handlers,
          resolveSession: (tool, input) => registry.match(tool, input),
        }),
    })
    const call = (name: string, args: Record<string, unknown>) =>
      startMockModel({ toolCall: { name, arguments: args } })
    mocks.ask = await call('kits_ask_user', { question: '用哪个环境？', assumption: '测试环境' })
    mocks.block = await call('kits_ask_user', { question: '要不要删数据？', blocking: true })
    mocks.output = await call('kits_submit_output', { output: { n: 1 } })
    mocks.remember = await call('kits_remember', { text: '测试命令是 pnpm test' })

    const result = generateOpencodeConfig({
      settings: parseSettings({
        gateways: Object.entries(mocks).map(([id, m]) => ({
          id,
          baseUrl: m.baseUrl,
          models: [{ id: MOCK_MODEL_ID }],
        })),
        defaultModel: `ask/${MOCK_MODEL_ID}`,
      }),
      agents: [builtinAssistant, cases],
      mcp,
      skills: [],
      instructions: [],
      gatewayKeys: Object.fromEntries(Object.keys(mocks).map((k) => [k, 'k'])),
      lookupVar: () => undefined,
      kitsTools: { url: tools.url, token: tools.token },
    })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    const configDir = path.join(root, 'config')
    await opencodeDialect.writeConfig(configDir, result.files)
    kernel = new OpencodeFamilyKernel(opencodeDialect, { pollIntervalMs: 1_000 })
    await kernel.start({
      binary: binary ?? '',
      configDir,
      dataDir: path.join(root, 'data'),
      env: result.files.env,
    })
  }, 60_000)

  afterAll(async () => {
    await kernel?.dispose()
    await tools?.close()
    for (const m of Object.values(mocks)) await m.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function run(gateway: string, agent = builtinAssistant) {
    const s: KernelSession = await kernel.createSession({
      workdir,
      agent: agent.name,
      model: `${gateway}/${MOCK_MODEL_ID}`,
      permission: agentPermissions(agent, 'ask', mcp),
    })
    if (agent.outputSchema) sessionsWithSchema.add(s.id)
    const events: KernelEvent[] = []
    for await (const e of kernel.prompt(s, { text: '开始' })) {
      events.push(e)
      // SessionService 以后做的事：kits 工具的 tool-start 登记到关联表
      if (e.type === 'tool-start' && e.name.startsWith('kits_')) {
        registry.register(s.id, e.name.slice('kits_'.length), e.input)
      }
    }
    const end = events.find((e) => e.type === 'tool-end')
    return { s, events, end: end?.type === 'tool-end' ? end : undefined }
  }

  it('connects to the kits server and matches a non-blocking question to its session', async () => {
    const { s, events, end } = await run('ask')
    expect(calls.at(-1)).toEqual({
      tool: 'ask_user',
      sessionId: s.id,
      input: { question: '用哪个环境？', assumption: '测试环境', blocking: false },
    })
    expect(String(end?.output)).toContain('测试环境')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('keeps a blocking question open until the user answers', async () => {
    const started = Date.now()
    const { end, events } = await run('block')
    expect(Date.now() - started).toBeGreaterThanOrEqual(BLOCK_MS)
    expect(end?.error).toBeUndefined()
    expect(String(end?.output)).toContain('用预发环境')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('accepts submit_output for an agent with an output format', async () => {
    const { s, end } = await run('output', cases)
    expect(calls.at(-1)).toEqual({ tool: 'submit_output', sessionId: s.id, input: { n: 1 } })
    expect(String(end?.output)).toContain('已提交')
  }, 60_000)

  it('records remember calls against the session', async () => {
    const { s } = await run('remember')
    expect(calls.at(-1)).toEqual({
      tool: 'remember',
      sessionId: s.id,
      input: { text: '测试命令是 pnpm test', scope: 'project' },
    })
  }, 60_000)
})

// 内核默认 60 s 掐断 MCP 调用；kits 服务配了 timeout 才能让阻塞提问等人。
// 这里把 timeout 调到 2 s、让处理函数挂 5 s，确认这个字段管的就是调用超时（升级内核时会先报）
describe.skipIf(!binary)('kits tool call timeout', () => {
  it('cuts a call that runs past the configured timeout', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-timeout-'))
    const workdir = path.join(root, 'work')
    mkdirSync(workdir)
    const registry = new ToolCallRegistry()
    const tools = await startKitsToolHttpServer({
      createServer: () =>
        createKitsToolServer({
          handlers: {
            askUser: async () => {
              await new Promise((r) => setTimeout(r, 5_000))
              return { answered: true, answer: 'late' }
            },
            outputSchema: () => undefined,
            onOutput: async () => {},
            remember: async () => {},
          },
          resolveSession: (tool, input) => registry.match(tool, input),
        }),
    })
    const model = await startMockModel({
      toolCall: { name: 'kits_ask_user', arguments: { question: 'q', blocking: true } },
    })
    const kernel = new OpencodeFamilyKernel(opencodeDialect, { pollIntervalMs: 1_000 })
    try {
      const result = generateOpencodeConfig({
        settings: parseSettings({
          gateways: [{ id: 'm', baseUrl: model.baseUrl, models: [{ id: MOCK_MODEL_ID }] }],
          defaultModel: `m/${MOCK_MODEL_ID}`,
        }),
        agents: [builtinAssistant],
        mcp,
        skills: [],
        instructions: [],
        gatewayKeys: { m: 'k' },
        lookupVar: () => undefined,
        kitsTools: { url: tools.url, token: tools.token, timeoutMs: 2_000 },
      })
      if (!result.ok) throw new Error(JSON.stringify(result.problems))
      await opencodeDialect.writeConfig(path.join(root, 'config'), result.files)
      await kernel.start({
        binary: binary ?? '',
        configDir: path.join(root, 'config'),
        dataDir: path.join(root, 'data'),
        env: result.files.env,
      })
      const s = await kernel.createSession({
        workdir,
        agent: 'assistant',
        permission: agentPermissions(builtinAssistant, 'ask', mcp),
      })
      const events: KernelEvent[] = []
      for await (const e of kernel.prompt(s, { text: '问一下' })) events.push(e)
      const end = events.find((e) => e.type === 'tool-end')
      expect(end?.type === 'tool-end' && end.error).toBeTruthy()
    } finally {
      await kernel.dispose()
      await tools.close()
      await model.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
