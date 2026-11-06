import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
const GIT_CONFIG_PROMPT = '改 git 配置'

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
    mocks.lazy = await startMockModel({ firstByteDelayMs: 1_500 })
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
    mocks.parallel = await startMockModel({
      toolCalls: ['kits-p1', 'kits-p2'].map((name) => ({
        name: 'bash',
        arguments: { command: `touch ${name}.txt`, description: 'Touch a file' },
      })),
    })
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
    // 主会话派子任务，子任务写 .git/config：子任务只继承 deny，保护路径要写在全局规则里才管得到
    const gitConfig = {
      name: 'write',
      arguments: { filePath: path.join(workdir, '.git/config'), content: '[core]\n' },
    }
    mocks.guarded = await startMockModel({ toolCall: gitConfig })
    mocks.guardedsub = await startMockModel({
      pickTool: (body) =>
        JSON.stringify(body.messages).includes(GIT_CONFIG_PROMPT)
          ? gitConfig
          : {
              name: 'task',
              arguments: {
                description: '改配置',
                subagent_type: 'general',
                prompt: GIT_CONFIG_PROMPT,
              },
            },
    })
    mocks.skills = await startMockModel()
    mocks.force = await startMockModel({
      toolCall: {
        name: 'bash',
        arguments: { command: 'git push --force origin main', description: 'Force push' },
      },
    })
    mocks.secret = await startMockModel({
      toolCall: {
        name: 'bash',
        arguments: { command: 'wc -c $HOME/.ssh/config', description: 'Size' },
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
      gatewayKeys: {
        ok: 'k',
        flaky: 'k',
        lazy: 'k',
        slow: 'k',
        chain: 'k',
        writer: 'k',
        subagent: 'k',
        parallel: 'k',
        guarded: 'k',
        guardedsub: 'k',
        force: 'k',
        skills: 'k',
        secret: 'k',
      },
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
    onPermission: (e: Extract<KernelEvent, { type: 'permission-request' }>) => Promise<unknown>,
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

  it('stops asking once the session rules allow the command', async () => {
    const s = await session('ok')
    await kernel.setPermission(s, agentPermissions(builtinAssistant, 'auto', mcp))
    const events = await run(s, '用 printf 打印 hi', () => Promise.reject(new Error('不该再问')))
    expect(events.some((e) => e.type === 'permission-request')).toBe(false)
    expect(events.some((e) => e.type === 'tool-end')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('hands a message sent during a turn to the next step of that turn', async () => {
    const s = await session('ok')
    const before = mocks.ok?.requests.length ?? 0
    let sent = false
    const events = await run(s, '用 printf 打印 hi', async (e) => {
      if (!sent) {
        sent = true
        expect(await kernel.interject(s, { text: '插一句：顺便看下日志' })).toBe(true)
      }
      await kernel.respondPermission(s, e.requestId, 'once')
    })
    const types = events.map((e) => e.type)

    const seen = (mocks.ok?.requests ?? []).slice(before).filter((r) => r.tools?.length)
    const roles = seen[1]?.messages?.map((m) => m.role).slice(-2)
    expect(JSON.stringify(seen[1]?.messages)).toContain('插一句')
    expect(roles).toEqual(['tool', 'user'])
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
    expect(types.filter((t) => t === 'interject-delivered')).toHaveLength(1)
    expect(types.indexOf('tool-end')).toBeLessThan(types.indexOf('interject-delivered'))
    expect(joined(events, 'text-delta')).not.toContain('插一句')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 60_000)

  it('keeps one turn when a message arrives while the model writes its last reply', async () => {
    const s = await session('lazy')
    let sent = false
    const events = await run(
      s,
      '用 printf 打印 hi',
      (e) => kernel.respondPermission(s, e.requestId, 'once'),
      (e) => {
        if (e.type !== 'tool-end' || sent) return
        sent = true
        // 这时模型已经在写最后的回复（假网关首字等 1.5 秒）
        setTimeout(() => void kernel.interject(s, { text: '最后再补一句' }), 700)
      },
    )
    const types = events.map((e) => e.type)

    const seen = (mocks.lazy?.requests ?? []).filter((r) => r.tools?.length)
    expect(JSON.stringify(seen)).toContain('最后再补一句')
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
    expect(types.indexOf('text-delta')).toBeLessThan(types.indexOf('interject-delivered'))
    expect(types.at(-1)).toBe('done')
  }, 60_000)

  it('keeps a message sent before a stop for the next turn', async () => {
    const s = await session('ok')
    const stopped = await run(s, '用 printf 打印 hi', async () => {
      await kernel.interject(s, { text: '插话后停止' })
      await kernel.abort(s)
    })
    expect(stopped.at(-1)).toEqual({ type: 'done', reason: 'aborted' })

    const before = mocks.ok?.requests.length ?? 0
    const next = await run(s, '继续', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    expect(next.at(-1)).toEqual({ type: 'done', reason: 'completed' })
    expect(JSON.stringify((mocks.ok?.requests ?? []).slice(before))).toContain('插话后停止')
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

  it('reports the requests the kernel settled along with a reject', async () => {
    const s = await session('parallel')
    const asked: string[] = []
    let late: boolean | undefined
    const events = await run(
      s,
      '并行建两个文件',
      async (e) => {
        asked.push(e.requestId)
        // 两个请求都到了再回复第一个，内核连带拒绝第二个
        if (asked.length === 2) await kernel.respondPermission(s, asked[0] as string, 'reject')
      },
      (e) => {
        if (e.type === 'permission-replied' && e.requestId === asked[1]) {
          void kernel.respondPermission(s, e.requestId, 'once').then((live) => {
            late = live
          })
        }
      },
    )
    expect(events.filter((e) => e.type === 'permission-replied')).toEqual(
      asked.map((requestId) => ({ type: 'permission-replied', requestId, reply: 'reject' })),
    )
    expect(late).toBe(false)
    expect(events.at(-1)?.type).toBe('done')
  }, 60_000)

  it('asks before writing into .git, which would turn git status into a command', async () => {
    const s = await session('guarded')
    const asked: { tool: string; patterns: string[]; always: string[] }[] = []
    await run(s, '改配置', (e) => {
      asked.push({ tool: e.tool, patterns: e.patterns, always: e.always })
      return kernel.respondPermission(s, e.requestId, 'reject', '不要改')
    })
    expect(asked).toEqual([{ tool: 'edit', patterns: ['.git/config'], always: ['.git/config'] }])
  }, 60_000)

  it('asks when a subagent writes into .git as well', async () => {
    const s = await session('guardedsub')
    const asked: string[] = []
    await run(s, '派子任务', (e) => {
      asked.push(e.tool)
      return kernel.respondPermission(s, e.requestId, 'reject', '不要改')
    })
    expect(asked).toEqual(['edit'])
  }, 60_000)

  it('denies a force push without asking', async () => {
    const s = await session('force')
    const events = await run(s, '强推', () => Promise.reject(new Error('不该问')))
    const end = events.find((e) => e.type === 'tool-end')
    expect(end && end.type === 'tool-end' && end.error).toBeTruthy()
  }, 60_000)

  it('asks before a whitelisted command reads a secret path', async () => {
    const s = await session('secret')
    const asked: string[][] = []
    await run(s, '看大小', (e) => {
      asked.push(e.patterns)
      return kernel.respondPermission(s, e.requestId, 'reject', '不要读')
    })
    expect(asked).toEqual([['wc -c $HOME/.ssh/config']])
  }, 60_000)

  it('still finds the project skills with the project config off', async () => {
    const dir = path.join(path.dirname(workdir), 'with-skill')
    mkdirSync(path.join(dir, '.agents/skills/kits-project-skill'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(
      path.join(dir, '.agents/skills/kits-project-skill/SKILL.md'),
      '---\nname: kits-project-skill\ndescription: 项目技能探针\n---\n正文\n',
    )
    const s = await kernel.createSession({
      workdir: dir,
      agent: 'assistant',
      model: `skills/${MOCK_MODEL_ID}`,
      title: 'contract',
      permission: agentPermissions(builtinAssistant, 'ask', mcp),
    })
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    expect(JSON.stringify(mocks.skills?.requests)).toContain('项目技能探针')
  }, 60_000)

  it('does not load plugins from the working directory', async () => {
    const dir = path.join(path.dirname(workdir), 'cloned')
    const marker = path.join(path.dirname(workdir), 'plugin-ran')
    mkdirSync(path.join(dir, '.opencode/plugin'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(
      path.join(dir, '.opencode/plugin/p.js'),
      `import { writeFileSync } from 'node:fs'
export const P = async () => {
  writeFileSync(${JSON.stringify(marker)}, 'x')
  return {}
}
`,
    )
    const s = await kernel.createSession({
      workdir: dir,
      agent: 'assistant',
      model: `ok/${MOCK_MODEL_ID}`,
      title: 'contract',
      permission: agentPermissions(builtinAssistant, 'ask', mcp),
    })
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    expect(existsSync(marker)).toBe(false)
  }, 120_000)

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
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    const messages = await kernel.messages(s)
    expect(messages.map((m) => m.info.role)).toContain('assistant')
    expect(await kernel.diff(s)).toEqual([])
  }, 60_000)

  it('compacts a session and returns the summary text', async () => {
    const s = await session('ok')
    await run(s, '打印 hi', (e) => kernel.respondPermission(s, e.requestId, 'once'))
    const result = await kernel.summarize(s)
    // 假网关没带工具的请求回固定的一句，压缩请求也走这里
    expect(result.summary).toContain(MOCK_TITLE)
  }, 60_000)
})
