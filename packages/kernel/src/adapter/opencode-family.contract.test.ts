import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinAssistant, type KernelEvent, parseMcpFile, parseSettings } from '@kits/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect } from '../dialects/opencode'
import { agentPermissions, generateOpencodeConfig } from '../generate/opencode-config'
import type { KernelSession } from '../kernel'
import { MOCK_MODEL_ID, MOCK_TITLE, type MockModel, startMockModel } from '../testing/mock-model'
import { OpencodeFamilyKernel } from './opencode-family'

// 契约测试（phase1-implementation 4.5 节）：真实 opencode serve + 假网关走完整一轮：
// 建会话 → prompt → 收到权限请求 → 回复 → tool-end → 正文 → done。三个假网关分别是正常、先失败一次、首字很慢。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

const mcp = parseMcpFile({})
const SUBAGENT_PROMPT = '建一个文件'

describe.skipIf(!binary)('OpencodeFamilyKernel against opencode serve', () => {
  let root: string
  let workdir: string
  let kernel: OpencodeFamilyKernel
  const mocks: Record<string, MockModel> = {}

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-adapter-'))
    // macOS 的临时目录在 /var 下，它是 /private/var 的软链接：内核按真实路径判断目录内外，这里也用真实路径。
    // diff 靠内核的快照，工作目录是 git 仓库时才有
    workdir = path.join(realpathSync(root), 'work')
    mkdirSync(workdir)
    execFileSync('git', ['init', '-q'], { cwd: workdir })
    mocks.ok = await startMockModel()
    mocks.flaky = await startMockModel({ failFirst: 1 })
    mocks.slow = await startMockModel({ firstByteDelayMs: 30_000 })
    // 写一个新文件，用来看 diff 的映射
    mocks.writer = await startMockModel({
      toolCall: {
        name: 'write',
        arguments: { filePath: path.join(workdir, 'hello.txt'), content: 'hi\n' },
      },
    })
    mocks.chain = await startMockModel({
      toolCall: {
        name: 'bash',
        arguments: { command: 'ls && touch kits-chain.txt', description: 'chain' },
      },
    })
    // 主会话派子任务，子任务跑一条要确认的命令
    mocks.subagent = await startMockModel({
      pickTool: (body) =>
        JSON.stringify(body.messages).includes(SUBAGENT_PROMPT)
          ? { name: 'bash', arguments: { command: 'touch kits-sub.txt', description: 'touch' } }
          : {
              name: 'task',
              arguments: {
                description: '建文件',
                subagent_type: 'general',
                prompt: SUBAGENT_PROMPT,
              },
            },
    })
    const result = generateOpencodeConfig({
      settings: parseSettings({
        gateways: Object.entries(mocks).map(([id, m]) => ({
          id,
          baseUrl: m.baseUrl,
          models: [{ id: MOCK_MODEL_ID }],
        })),
        defaultModel: `ok/${MOCK_MODEL_ID}`,
      }),
      agents: [builtinAssistant],
      mcp,
      skills: [],
      instructions: [],
      gatewayKeys: { ok: 'k', flaky: 'k', slow: 'k', chain: 'k', writer: 'k', subagent: 'k' },
      lookupVar: () => undefined,
    })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    const configDir = path.join(root, 'config')
    await opencodeDialect.writeConfig(configDir, result.files)
    kernel = new OpencodeFamilyKernel(opencodeDialect, {
      pollIntervalMs: 1_000,
      abortGraceMs: 3_000,
    })
    await kernel.start({
      binary: binary ?? '',
      configDir,
      dataDir: path.join(root, 'data'),
      // registry 连不上：等 npm 安装的话，下面的用例都会超时
      env: { ...result.files.env, npm_config_registry: 'http://127.0.0.1:9' },
    })
  }, 60_000)

  afterAll(async () => {
    await kernel?.dispose()
    for (const m of Object.values(mocks)) await m.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function session(gateway: string): Promise<KernelSession> {
    return kernel.createSession({
      workdir,
      agent: 'assistant',
      model: `${gateway}/${MOCK_MODEL_ID}`,
      title: 'contract',
      permission: agentPermissions(builtinAssistant, 'ask', mcp),
    })
  }

  // 跑一轮，权限请求按 onPermission 的返回回复
  async function run(
    s: KernelSession,
    text: string,
    onPermission: (e: Extract<KernelEvent, { type: 'permission-request' }>) => Promise<void>,
    onEvent?: (e: KernelEvent) => void,
  ): Promise<KernelEvent[]> {
    const events: KernelEvent[] = []
    for await (const e of kernel.prompt(s, { text })) {
      events.push(e)
      onEvent?.(e)
      if (e.type === 'permission-request') await onPermission(e)
    }
    return events
  }

  const joined = (events: KernelEvent[], type: 'text-delta' | 'reasoning-delta') =>
    events.flatMap((e) => (e.type === type ? [e.text] : [])).join('')

  it('streams a full turn through a permission request to done', async () => {
    const s = await session('ok')
    const events = await run(s, '用 printf 打印 hi', (e) =>
      kernel.respondPermission(s, e.requestId, 'once'),
    )
    const types = events.map((e) => e.type)

    const permission = events.find((e) => e.type === 'permission-request')
    expect(permission).toMatchObject({ tool: 'bash', patterns: ["printf 'hi'"] })
    const start = events.find((e) => e.type === 'tool-start')
    expect(start).toMatchObject({
      name: 'bash',
      input: { command: "printf 'hi'", description: 'Print hi' },
    })
    // 配置目录里的插件把 description 加进了模型看到的参数表，其余参数还在
    const bash = (mocks.ok?.requests ?? [])
      .flatMap((r) => (r.tools ?? []) as { function: { name: string; parameters: unknown } }[])
      .find((t) => t.function.name === 'bash')
    expect(bash?.function.parameters).toMatchObject({
      properties: {
        command: expect.anything(),
        description: expect.anything(),
        timeout: expect.anything(),
        workdir: expect.anything(),
      },
      required: expect.arrayContaining(['description']),
    })
    const end = events.find((e) => e.type === 'tool-end')
    // OpenCode 1.19.5 在 CI 上偶尔拿不到很快就退出的命令的输出，回 "(no output)"；这里验的是映射，两种都接受
    expect(end && end.type === 'tool-end' && String(end.output)).toMatch(/hi|\(no output\)/)
    expect(types.indexOf('tool-start')).toBeLessThan(types.indexOf('tool-end'))

    expect(joined(events, 'text-delta')).toBe('命令输出：hi')
    expect(joined(events, 'reasoning-delta')).toBe('命令跑完了，汇报结果。')
    // 用户自己的消息不能当成回复
    expect(joined(events, 'text-delta')).not.toContain('printf 打印')
    expect(events.some((e) => e.type === 'usage' && e.inputTokens > 0)).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.state === 'busy')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('passes the reject reason to the model as tool feedback', async () => {
    const s = await session('ok')
    const events = await run(s, '打印 hi', (e) =>
      kernel.respondPermission(s, e.requestId, 'reject', '不要执行命令，直接回答'),
    )
    const end = events.find((e) => e.type === 'tool-end')
    expect(end && end.type === 'tool-end' && end.error).toContain('不要执行命令')
    expect(events.at(-1)?.type).toBe('done')
  }, 60_000)

  it('reports a retry when the gateway fails and then completes', async () => {
    const s = await session('flaky')
    const events = await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    const retry = events.find((e) => e.type === 'retry')
    expect(retry).toMatchObject({ attempt: 1 })
    expect(retry && retry.type === 'retry' && retry.nextAt).toBeGreaterThan(0)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 90_000)

  it('ends the turn as aborted after abort', async () => {
    const s = await session('slow')
    let aborting: Promise<void> | undefined
    const events = await run(
      s,
      '打印 hi',
      async () => {},
      (e) => {
        if (e.type === 'status' && e.state === 'busy' && !aborting) aborting = kernel.abort(s)
      },
    )
    await aborting
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
  }, 60_000)

  it('asks for the non-whitelisted part of a chained command', async () => {
    // 只读白名单只写了单条命令的模式；串起来的命令由内核拆开逐条判断
    const s = await session('chain')
    const asked: string[][] = []
    await run(s, '列目录再建文件', async (e) => {
      asked.push(e.patterns)
      await kernel.respondPermission(s, e.requestId, 'reject')
    })
    // 一次请求列出拆开后的每条命令，有一条不在白名单就整体询问
    expect(asked).toEqual([['ls', 'touch kits-chain.txt']])
  }, 60_000)

  it('asks for a command of a subagent and finishes the turn after the reply', async () => {
    const s = await session('subagent')
    const events = await run(s, '派个子任务', (e) =>
      kernel.respondPermission(s, e.requestId, 'once'),
    )
    expect(events.find((e) => e.type === 'permission-request')).toMatchObject({
      tool: 'bash',
      patterns: ['touch kits-sub.txt'],
      subagent: true,
    })
    expect(existsSync(path.join(workdir, 'kits-sub.txt'))).toBe(true)
    const task = events.find((e) => e.type === 'tool-start' && e.name === 'task')
    const sub = events.find((e) => e.type === 'tool-start' && e.name === 'bash')
    const taskId = task?.type === 'tool-start' ? task.callId : ''
    expect(sub).toMatchObject({
      parentCallId: taskId,
      callId: expect.stringContaining(`${taskId}/`),
    })
    const end = events.find((e) => e.type === 'tool-end' && e.callId === taskId)
    expect(end && end.type === 'tool-end' && end.error).toBeUndefined()
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('maps the diff of a file the agent wrote', async () => {
    const s = await session('writer')
    await run(s, '建一个 hello.txt', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    // 每轮的改动是内核在这一轮结束后异步算出来写到用户消息上的，CI 上要等一会儿
    let diff = await kernel.diff(s)
    for (let i = 0; i < 30 && diff.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500))
      diff = await kernel.diff(s)
    }
    expect(diff).toEqual([
      expect.objectContaining({
        path: 'hello.txt',
        status: 'added',
        additions: 1,
        deletions: 0,
        turn: 1,
      }),
    ])
    expect(diff[0]?.patch).toContain('+hi')
  }, 60_000)

  it('reads back the session messages and an empty diff', async () => {
    const s = await session('ok')
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'always'))
    const messages = await kernel.messages(s)
    expect(messages.map((m) => m.info.role)).toContain('assistant')
    expect(await kernel.diff(s)).toEqual([])
  }, 60_000)

  it('compacts a session and returns the summary text', async () => {
    const s = await session('ok')
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'always'))
    const result = await kernel.summarize(s)
    // 假网关没带工具的请求回固定的一句，压缩请求也走这里
    expect(result.summary).toContain(MOCK_TITLE)
  }, 60_000)
})
