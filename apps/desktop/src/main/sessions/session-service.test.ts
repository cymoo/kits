import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinAssistant, type PushEvents, parseMcpFile, type SessionStatus } from '@kits/core'
import { MockKernel, type MockScenarioName } from '@kits/kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db'
import { ConfigProblemsError } from '../kernel/kernel-manager'
import { exportName, mergeDiffs, SessionService, titleOf } from './session-service'
import { SessionStore } from './session-store'

const migrations = path.resolve(import.meta.dirname, '../../../drizzle')
let close: (() => void) | undefined
let exportsDir = ''
afterEach(() => {
  close?.()
  close = undefined
  if (exportsDir) rmSync(exportsDir, { recursive: true, force: true })
  exportsDir = ''
})

// api-reviewer 那种有输出格式的 Agent
const findingsSchema = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array' } },
}

// gate：内核启动卡住，直到调用 open（模拟真实内核冷启动）
function setup(
  scenario: MockScenarioName | 'broken',
  gate?: Promise<void>,
  diffDelays: number[] = [],
) {
  const db = openDatabase(':memory:', migrations)
  close = db.close
  exportsDir = mkdtempSync(path.join(os.tmpdir(), 'kits-exports-'))
  const store = new SessionStore(db.db)
  const pushed: { channel: keyof PushEvents; payload: unknown }[] = []
  // Mock 内核的 ask_user 走会话服务，和应用里一样
  let service: SessionService | undefined
  const kernel = new MockKernel({
    scenario: scenario === 'broken' ? 'done' : scenario,
    speed: 0,
    tools: {
      askUser: (i, ctx) => (service as SessionService).askUser(i, ctx),
      outputSchema: (ctx) => (service as SessionService).outputSchema(ctx),
      onOutput: (o, ctx) => (service as SessionService).onOutput(o, ctx),
    },
  })
  const registered: unknown[] = []
  service = new SessionService({
    store,
    kernels: {
      acquire: async () => {
        await gate
        if (scenario === 'broken') {
          throw new ConfigProblemsError([
            { section: 'model', target: 'gateways', message: '还没有启用的模型网关' },
          ])
        }
        return kernel
      },
      release: () => {},
    },
    resolveAgent: (name) =>
      name === 'reviewer'
        ? { ...builtinAssistant, name, source: 'project', prompt: '只读，不改文件' }
        : scenario === 'output-structured'
          ? { ...builtinAssistant, name: 'api-reviewer', outputSchema: findingsSchema }
          : builtinAssistant,
    loadMcp: () => parseMcpFile({}),
    registry: { register: (...args: unknown[]) => void registered.push(args) },
    push: (channel, payload) => void pushed.push({ channel, payload }),
    flushMs: 5,
    diffDelays,
    exportsDir,
    attachmentsDir: exportsDir,
  })
  const statusOf = (id: string) => store.session(id)?.status
  const waitFor = (id: string, statuses: SessionStatus[]) =>
    vi.waitFor(() => expect(statuses).toContain(statusOf(id)), { timeout: 3_000 })
  return { service, store, pushed, kernel, waitFor, registered }
}

// 等确认的那条权限请求的 id（Mock 每次发的 id 都不一样）
function pendingRequest(store: SessionStore, id: string): string {
  const part = store
    .detail(id)
    ?.parts.find((p) => p.type === 'permission' && p.status === 'pending')
  return part?.payload.type === 'permission' ? part.payload.requestId : ''
}

const input = {
  text: '给兑换接口加幂等校验，改完跑 tests/points',
  workdir: '/w',
  agent: 'assistant',
  model: 'corp/m',
  kernel: 'opencode' as const,
  permissionMode: 'ask' as const,
}

describe('SessionService', () => {
  it('runs a turn to done and stores the user message, tool steps and the answer', async () => {
    const { service, waitFor, store } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const detail = store.detail(s.id)
    expect(detail?.session).toMatchObject({ title: input.text, turns: 1, status: 'done' })
    expect(detail?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(detail?.messages[0]?.text).toBe(input.text)
    expect(detail?.messages[1]).toMatchObject({
      finishReason: 'completed',
      tokens: { input: 21_400 },
    })
    const types = detail?.parts.map((p) => p.type)
    expect(types).toEqual(['reasoning', 'tool', 'tool', 'tool', 'text'])
    const answer = detail?.parts.at(-1)
    expect(answer?.payload).toMatchObject({ text: expect.stringContaining('改好了') })
  })

  it('pushes session, message and part updates to the renderer', async () => {
    const { service, waitFor, pushed } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const channels = new Set(pushed.map((p) => p.channel))
    expect([...channels].sort()).toEqual([
      'session.activity',
      'session.changed',
      'session.message',
      'session.part',
    ])
  })

  it('waits for a permission reply and goes back to running after it', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await waitFor(s.id, ['done'])
    const perm = store.detail(s.id)?.parts.find((p) => p.type === 'permission')
    expect(perm?.status).toBe('once')
  })

  it('closes the card without an error when the kernel no longer has the request', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const requestId = pendingRequest(store, s.id)
    const respond = vi.spyOn(kernel, 'respondPermission').mockResolvedValueOnce(false)
    await service.respondPermission({ id: s.id, requestId, reply: 'once' })
    await vi.waitFor(() =>
      expect(store.detail(s.id)?.parts.find((p) => p.type === 'permission')?.status).toBe(
        'expired',
      ),
    )
    expect(store.session(s.id)?.status).toBe('running')
    respond.mockRestore()
    await service.abort(s.id)
  })

  it('answers a request the user already allowed for this session', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'always',
    })
    await waitFor(s.id, ['done'])
    await service.prompt(s.id, '再跑一遍')
    await vi.waitFor(() => expect(store.session(s.id)).toMatchObject({ turns: 2, status: 'done' }))
    const cards = store.detail(s.id)?.parts.filter((p) => p.type === 'permission')
    expect(cards?.map((p) => p.status)).toEqual(['always'])
  })

  it('shows the permission card of a subagent when the session would ask too', async () => {
    const { service, waitFor, store } = setup('subagent')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await waitFor(s.id, ['done'])
  })

  it('answers a subagent permission itself when the session allows the tool', async () => {
    const { service, waitFor, store } = setup('subagent')
    const s = await service.create({ ...input, permissionMode: 'auto' })
    await waitFor(s.id, ['done'])
    expect(store.detail(s.id)?.parts.filter((p) => p.type === 'permission')).toEqual([])
  })

  it('logs every permission decision', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const log = vi.spyOn(store, 'logPermission')
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'always',
    })
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: s.id, tool: 'bash', decision: 'always' }),
    )
    await waitFor(s.id, ['done'])
  })

  it('keeps the reason given with a rejection on the permission part', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'reject',
      message: '  先别跑测试  ',
    })
    await waitFor(s.id, ['done'])
    const perm = store.detail(s.id)?.parts.find((p) => p.type === 'permission')
    expect(perm).toMatchObject({ status: 'reject', payload: { message: '先别跑测试' } })
  })

  it('does not let a permission reply that lands after the turn ended change the session status', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    vi.spyOn(kernel, 'respondPermission').mockImplementation(async () => {
      // 回复还在路上，这一轮被停掉了
      await service.abort(s.id)
      await waitFor(s.id, ['aborted'])
      return true
    })
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    expect(store.session(s.id)?.status).toBe('aborted')
  })

  it('refuses to answer a blocking question once the turn has been stopped', async () => {
    const { service, waitFor, store } = setup('question')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const q = store.detail(s.id)?.parts.find((p) => p.type === 'question')
    const questionId = q?.payload.type === 'question' ? q.payload.questionId : ''
    await service.abort(s.id)
    await expect(service.answerQuestion({ id: s.id, questionId, answer: '预发' })).rejects.toThrow(
      '过期',
    )
    await waitFor(s.id, ['aborted'])
    await new Promise((r) => setTimeout(r, 30))
    expect(store.session(s.id)?.turns).toBe(1)
  })

  it('waits on a blocking question and continues with the answer', async () => {
    const { service, waitFor, store } = setup('question')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const q = store.detail(s.id)?.parts.find((p) => p.type === 'question')
    expect(q?.payload).toMatchObject({ question: '在哪个环境复现的？', blocking: true })
    const questionId = q?.payload.type === 'question' ? q.payload.questionId : ''
    await service.answerQuestion({ id: s.id, questionId, answer: '预发环境' })
    await waitFor(s.id, ['done'])
    const tool = store.detail(s.id)?.parts.find((p) => p.type === 'tool')
    expect(tool?.payload).toMatchObject({ output: expect.stringContaining('预发环境') })
    const answered = store.detail(s.id)?.parts.find((p) => p.type === 'question')
    expect(answered).toMatchObject({ status: 'answered', payload: { answer: '预发环境' } })
  })

  it('expires an unanswered question when the turn is stopped', async () => {
    const { service, waitFor, store } = setup('question')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    expect(store.detail(s.id)?.parts.find((p) => p.type === 'question')?.status).toBe('expired')
  })

  it('sends the answer to a non-blocking question as the next message', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const result = await service.askUser(
      {
        question: '用哪个库？',
        options: ['测试库', '本地库'],
        assumption: '测试库',
        blocking: false,
      },
      { sessionId: s.id },
    )
    expect(result).toEqual({ answered: false, assumption: '测试库' })
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await waitFor(s.id, ['done'])
    const q = store.detail(s.id)?.parts.find((p) => p.type === 'question')
    const questionId = q?.payload.type === 'question' ? q.payload.questionId : ''
    await service.answerQuestion({ id: s.id, questionId, answer: '本地库' })
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    expect(store.detail(s.id)?.messages.at(-2)?.text).toBe('关于“用哪个库？”：本地库')
    // 第二轮又会停在确认上，停掉再关库
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('queues follow-ups sent during a turn and sends them together afterwards', async () => {
    const { service, waitFor, store, pushed } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    await service.prompt(s.id, '改完提交')
    const queued = service.get(s.id)?.session.queued
    expect(queued?.map((q) => q.text)).toEqual(['顺便看下日志', '改完提交'])
    expect(pushed.at(-1)?.payload).toMatchObject({ queued })
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    expect(store.detail(s.id)?.messages.at(-2)?.text).toBe('顺便看下日志\n\n改完提交')
    expect(service.get(s.id)?.session.queued).toBeUndefined()
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('hands queued follow-ups back when the turn is stopped', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    await service.prompt(s.id, '改完提交')
    const draft = await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    await new Promise((r) => setTimeout(r, 50))
    expect(draft).toEqual({ text: '顺便看下日志\n\n改完提交', attachments: [] })
    expect(store.session(s.id)?.turns).toBe(1)
  })

  it('takes one queued message out for editing', async () => {
    const { service, waitFor } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    await service.prompt(s.id, '改完提交')
    const [first] = service.get(s.id)?.session.queued ?? []

    expect(service.dequeue(s.id, first?.id ?? '')?.text).toBe('顺便看下日志')
    expect(service.get(s.id)?.session.queued?.map((q) => q.text)).toEqual(['改完提交'])
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('hands a queued message to the running turn and keeps it out of the next one', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    const interject = vi.spyOn(kernel, 'interject')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    const [queued] = service.get(s.id)?.session.queued ?? []

    await service.interject({ id: s.id, queueId: queued?.id ?? '' })

    expect(interject.mock.calls[0]?.[1].text).toBe('顺便看下日志')
    expect(service.get(s.id)?.session.queued).toBeUndefined()
    const part = store.detail(s.id)?.parts.find((p) => p.type === 'interject')
    expect(part).toMatchObject({ status: 'pending', payload: { text: '顺便看下日志' } })
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await waitFor(s.id, ['done'])
    expect(store.session(s.id)?.turns).toBe(1)
    expect(store.detail(s.id)?.parts.find((p) => p.type === 'interject')?.status).toBe('sent')
  })

  it('sends typed text straight to the running turn', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])

    await service.interject({ id: s.id, text: '先别改测试' })

    expect(store.detail(s.id)?.parts.find((p) => p.type === 'interject')?.payload).toMatchObject({
      text: '先别改测试',
    })
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('numbers an interjection as a user message of the kernel, in its local turn', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])

    await service.interject({ id: s.id, text: '先别改测试' })

    expect([...store.kernelTurns(s.id)]).toEqual([
      [1, 1],
      [2, 1],
    ])
    expect(store.nextKernelTurn(s.id)).toBe(3)
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('puts the message back in the queue when the kernel refuses it', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    vi.spyOn(kernel, 'interject').mockResolvedValue(false)
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')

    await service.interject({ id: s.id })

    expect(service.get(s.id)?.session.queued?.map((q) => q.text)).toEqual(['顺便看下日志'])
    expect(store.detail(s.id)?.parts.some((p) => p.type === 'interject')).toBe(false)
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('puts the message back in the queue when the kernel call fails', async () => {
    const { service, waitFor, kernel } = setup('permission')
    vi.spyOn(kernel, 'interject').mockRejectedValue(new Error('连不上内核'))
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')

    await expect(service.interject({ id: s.id })).rejects.toThrow('连不上内核')

    expect(service.get(s.id)?.session.queued?.map((q) => q.text)).toEqual(['顺便看下日志'])
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('hands back an interjection still on its way when the turn is stopped', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    let cancel = (_: Error) => {}
    vi.spyOn(kernel, 'interject').mockImplementation(
      () =>
        new Promise((_, reject) => {
          cancel = reject
        }),
    )
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')

    const sending = service.interject({ id: s.id })
    const draft = await service.abort(s.id)
    cancel(new Error('This operation was aborted'))
    await sending
    await waitFor(s.id, ['aborted'])
    await new Promise((r) => setTimeout(r, 50))

    expect(draft?.text).toBe('顺便看下日志')
    expect(service.get(s.id)?.session.queued).toBeUndefined()
    expect(store.session(s.id)?.turns).toBe(1)
  })

  it('leaves typed text with the sender when a stop cancels its interjection', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    let cancel = (_: Error) => {}
    vi.spyOn(kernel, 'interject').mockImplementation(
      () =>
        new Promise((_, reject) => {
          cancel = reject
        }),
    )
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])

    const sending = service.interject({ id: s.id, text: '先别改测试' })
    const failed = expect(sending).rejects.toThrow()
    await vi.waitFor(() => expect(kernel.interject).toHaveBeenCalled())
    expect(await service.abort(s.id)).toBeNull()
    cancel(new Error('This operation was aborted'))
    await failed
    await waitFor(s.id, ['aborted'])

    expect(service.get(s.id)?.session.queued).toBeUndefined()
    expect(store.session(s.id)?.turns).toBe(1)
  })

  it('does not put a failed typed interjection in the queue, the sender keeps it', async () => {
    const { service, waitFor, kernel } = setup('permission')
    vi.spyOn(kernel, 'interject').mockRejectedValue(new Error('连不上内核'))
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])

    await expect(service.interject({ id: s.id, text: '先别改测试' })).rejects.toThrow('连不上内核')

    expect(service.get(s.id)?.session.queued).toBeUndefined()
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('still hands queued messages back when the stop request fails', async () => {
    const { service, waitFor, kernel } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    const abort = vi.spyOn(kernel, 'abort').mockRejectedValueOnce(new Error('内核没有回应'))

    const draft = await service.abort(s.id)

    expect(draft?.text).toBe('顺便看下日志')
    abort.mockRestore()
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('tells the page the running turn can take an interjection', async () => {
    const { service, waitFor } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    expect(service.get(s.id)?.session.canInterject).toBe(true)
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('stops a running turn', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    expect(store.detail(s.id)?.messages[1]?.finishReason).toBe('aborted')
  })

  it('shows missing settings as the error of the turn', async () => {
    const { service, waitFor, store } = setup('broken')
    const s = await service.create(input)
    await waitFor(s.id, ['error'])
    expect(store.session(s.id)?.lastError).toBe('配置不完整：还没有启用的模型网关')
    expect(store.detail(s.id)?.parts[0]).toMatchObject({ type: 'error' })
  })

  it('starts a second turn in the same kernel session', async () => {
    const { service, waitFor, store } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const ks = store.kernelSessionId(s.id)
    await service.prompt(s.id, '再跑一遍测试')
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    await waitFor(s.id, ['done'])
    expect(store.kernelSessionId(s.id)).toBe(ks)
    expect(store.detail(s.id)?.messages.map((m) => m.turn)).toEqual([1, 1, 2, 2])
  })

  it('registers kits tool calls for session correlation', async () => {
    const { service, waitFor, registered } = setup('output-structured')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    expect(registered).toEqual([[s.id, 'submit_output', expect.anything()]])
  })
})

describe('SessionService while the kernel is starting', () => {
  const deferred = () => {
    let open = () => {}
    const gate = new Promise<void>((r) => {
      open = r
    })
    return { gate, open }
  }

  it('queues a follow-up sent while the first turn is still waiting for the kernel', async () => {
    const { gate, open } = deferred()
    const { service, waitFor, store } = setup('done', gate)
    const s = await service.create(input)
    await service.prompt(s.id, '再来一轮')
    expect(store.session(s.id)?.turns).toBe(1)
    expect(service.get(s.id)?.session.queued?.map((q) => q.text)).toEqual(['再来一轮'])
    open()
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    await waitFor(s.id, ['done'])
  })

  it('stops a turn before it is sent when abort comes during the kernel start', async () => {
    const { gate, open } = deferred()
    const { service, waitFor, store, kernel } = setup('done', gate)
    const prompt = vi.spyOn(kernel, 'prompt')
    const s = await service.create(input)
    await service.abort(s.id)
    open()
    await waitFor(s.id, ['aborted'])
    expect(prompt).not.toHaveBeenCalled()
    expect(store.detail(s.id)?.messages[1]?.finishReason).toBe('aborted')
  })
})

describe('SessionService when the kernel cannot start', () => {
  it('drops queued follow-ups before pushing the failed turn', async () => {
    let open = () => {}
    const gate = new Promise<void>((r) => {
      open = r
    })
    const { service, waitFor, pushed } = setup('broken', gate)
    const s = await service.create(input)
    await service.prompt(s.id, '顺便看下日志')
    open()
    await waitFor(s.id, ['error'])
    const last = pushed.filter((p) => p.channel === 'session.changed').at(-1)?.payload
    expect(last).not.toHaveProperty('queued')
  })
})

describe('SessionStore.markInterrupted', () => {
  it('finishes the open assistant message and leaves an error part', async () => {
    const { gate } = { gate: new Promise<void>(() => {}) }
    const { service, store } = setup('done', gate)
    const s = await service.create(input)
    expect(store.markInterrupted(99)).toBe(1)
    const detail = store.detail(s.id)
    expect(detail?.session).toMatchObject({
      status: 'error',
      lastError: '应用退出时这一轮还没做完',
    })
    expect(detail?.messages[1]).toMatchObject({ finishReason: 'error', completedAt: 99 })
    expect(detail?.parts.at(-1)).toMatchObject({
      type: 'error',
      payload: { message: '应用退出时这一轮还没做完' },
    })
  })
})

describe('SessionService diffs', () => {
  it('stores the files changed in a turn once the kernel has them and pushes them', async () => {
    const { service, waitFor, pushed } = setup('done', undefined, [0])
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    await vi.waitFor(() => expect(service.diffs(s.id)).toHaveLength(1))
    expect(service.diffs(s.id)[0]).toMatchObject({
      turn: 1,
      path: 'src/points/redeem.py',
      status: 'modified',
      additions: 6,
    })
    expect(pushed.some((p) => p.channel === 'session.diffs')).toBe(true)
  })
})

describe('SessionStore.markInterrupted with questions', () => {
  it('keeps a non-blocking question pending so it can still be answered after a restart', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.askUser({ question: '用哪个库？', blocking: false }, { sessionId: s.id })
    store.markInterrupted(99)
    const parts = store.detail(s.id)?.parts ?? []
    expect(parts.find((p) => p.type === 'question')?.status).toBe('pending')
    expect(parts.find((p) => p.type === 'permission')?.status).toBe('expired')
    await service.abort(s.id)
    await waitFor(s.id, ['aborted', 'error'])
  })
})

describe('SessionService diffs across turns', () => {
  it('maps the kernel turns back to local turns when a turn was stopped before reaching the kernel', async () => {
    const { service, waitFor, store } = setup('done', undefined, [0])
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    // 第 2 轮刚发就停了，还没发到内核
    await service.prompt(s.id, '算了')
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    await service.prompt(s.id, '再改一遍')
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(3))
    await waitFor(s.id, ['done'])
    await vi.waitFor(() => expect(service.diffs(s.id).map((d) => d.turn)).toEqual([1, 3]))
  })
})

describe('SessionService outputs', () => {
  it('has no output when the agent has no output format', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    expect(service.outputs(s.id)).toEqual([])
  })

  it('hides a reply an older version stored as an output', async () => {
    const { service, store, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    store.saveDraft({ sessionId: s.id, turn: 1, kind: 'text', aiDraft: '回复' })
    expect(service.outputs(s.id)).toEqual([])
  })

  it('exports a session as markdown and as the full record', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const { path: md } = service.exportSession({ id: s.id, format: 'markdown' })
    expect(path.dirname(md)).toBe(exportsDir)
    expect(md).toMatch(/\d{8}-给兑换接口加幂等校验.*\.md$/)
    expect(readFileSync(md, 'utf8')).toContain('改好了')
    const { path: json } = service.exportSession({ id: s.id, format: 'json' })
    expect(JSON.parse(readFileSync(json, 'utf8')).session.id).toBe(s.id)
  })

  it('does not overwrite an earlier export with the same name', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const first = service.exportSession({ id: s.id, format: 'markdown' }).path
    const second = service.exportSession({ id: s.id, format: 'markdown' }).path
    expect(second).not.toBe(first)
    expect(second).toMatch(/-2\.md$/)
  })

  it('stores submit_output of an agent with an output format as the structured output', async () => {
    const { service, waitFor } = setup('output-structured')
    const s = await service.create({ ...input, agent: 'api-reviewer' })
    await waitFor(s.id, ['done'])
    const outputs = service.outputs(s.id)
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ kind: 'structured', turn: 1 })
    expect(outputs[0]?.aiDraft).toMatchObject({ findings: expect.any(Array) })
    const { path: file } = service.exportOutput({ id: outputs[0]?.id ?? '', format: 'json' })
    expect(JSON.parse(readFileSync(file, 'utf8')).findings).toHaveLength(2)
  })
})

describe('SessionService attachments', () => {
  const md = (text: string) => ({
    name: '需求.md',
    mime: 'text/markdown',
    data: new TextEncoder().encode(text),
  })

  it('stores the attachment, shows it on the user message and sends its text to the kernel', async () => {
    const { service, waitFor, store, kernel } = setup('done')
    const prompt = vi.spyOn(kernel, 'prompt')
    const s = await service.create({
      ...input,
      attachments: [md('# 积分兑换\n同一个请求号只兑换一次')],
    })
    await waitFor(s.id, ['done'])
    expect(prompt.mock.calls[0]?.[1]).toEqual({
      text: input.text,
      attachments: [{ name: '需求.md', text: '# 积分兑换\n同一个请求号只兑换一次' }],
    })
    const detail = store.detail(s.id)
    const user = detail?.messages.find((m) => m.role === 'user')
    expect(detail?.attachments).toEqual([
      expect.objectContaining({ messageId: user?.id, name: '需求.md', mime: 'text/markdown' }),
    ])
  })

  it('does not create the session when an attachment cannot be read', async () => {
    const { service, store } = setup('done')
    const png = { name: 'shot.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }
    await expect(service.create({ ...input, attachments: [png] })).rejects.toThrow('shot.png')
    expect(store.list()).toEqual([])
  })

  it('leaves no files behind when one attachment of a batch cannot be read', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const png = { name: 'shot.png', mime: 'image/png', data: new Uint8Array([1]) }
    await expect(service.prompt(s.id, '看看', [md('说明'), png])).rejects.toThrow('shot.png')
    const dir = path.join(exportsDir, s.id)
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([])
  })

  it('drops a follow-up whose attachments were still converting when the turn was stopped', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    let finish = () => {}
    const converting = new Promise<void>((r) => {
      finish = r
    })
    // 换掉转文本：卡住，等停止之后再放行
    ;(service as unknown as { deps: { extractText: unknown } }).deps.extractText = async () => {
      await converting
      return '说明'
    }
    const sent = service.prompt(s.id, '顺便看下', [md('说明')])
    await service.abort(s.id)
    finish()
    await sent
    await waitFor(s.id, ['aborted'])
    await new Promise((r) => setTimeout(r, 30))
    expect(store.session(s.id)?.turns).toBe(1)
    expect(service.get(s.id)?.session.queued).toBeUndefined()
  })

  it('keeps the attachments of a queued follow-up and sends them with the next turn', async () => {
    const { service, waitFor, store, kernel } = setup('permission')
    const prompt = vi.spyOn(kernel, 'prompt')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下这个', [md('附加说明')])
    await service.respondPermission({
      id: s.id,
      requestId: pendingRequest(store, s.id),
      reply: 'once',
    })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt.mock.calls[1]?.[1]).toMatchObject({
      text: '顺便看下这个',
      attachments: [{ name: '需求.md', text: '附加说明' }],
    })
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })
})

describe('SessionService platforms', () => {
  it('denies the tools of the platforms turned off for this session', async () => {
    const { service, waitFor, kernel } = setup('done')
    const create = vi.spyOn(kernel, 'createSession')
    const s = await service.create({ ...input, mcpOff: ['wiki'] })
    await waitFor(s.id, ['done'])
    expect(create.mock.calls[0]?.[0].permission.at(-1)).toEqual({
      tool: 'wiki_*',
      pattern: '*',
      level: 'deny',
    })
  })
})

describe('SessionService skills', () => {
  it('asks the kernel to load the skill named at the start of the message and shows the text as typed', async () => {
    const { service, waitFor, kernel, store } = setup('done')
    ;(service as unknown as { deps: { enabledSkills: unknown } }).deps.enabledSkills = () => [
      'test-plan',
    ]
    const prompt = vi.spyOn(kernel, 'prompt')
    const s = await service.create({ ...input, text: '/test-plan 按需求出用例' })
    await waitFor(s.id, ['done'])
    expect(prompt.mock.calls[0]?.[1].text).toContain('使用技能 test-plan')
    expect(store.detail(s.id)?.messages[0]?.text).toBe('/test-plan 按需求出用例')
  })

  it('runs a project agent on the base agent and sends its prompt as system', async () => {
    const { service, waitFor, kernel } = setup('done')
    const create = vi.spyOn(kernel, 'createSession')
    const prompt = vi.spyOn(kernel, 'prompt')
    const s = await service.create({ ...input, agent: 'reviewer' })
    await waitFor(s.id, ['done'])
    expect(create.mock.calls[0]?.[0].agent).toBe('_project')
    expect(prompt.mock.calls[0]?.[1].system).toBe('只读，不改文件')
  })
})

describe('SessionService setPinned', () => {
  it('pins and unpins without counting as an update, and pushes the change', async () => {
    const { service, store, pushed, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const before = store.session(s.id)?.updatedAt
    service.setPinned(s.id, true)
    expect(store.session(s.id)?.pinnedAt).toEqual(expect.any(Number))
    expect(store.session(s.id)?.updatedAt).toBe(before)
    expect(pushed.at(-1)).toMatchObject({
      channel: 'session.changed',
      payload: { id: s.id, pinnedAt: expect.any(Number) },
    })
    service.setPinned(s.id, false)
    expect(store.session(s.id)?.pinnedAt).toBeNull()
  })
})

describe('SessionService rename', () => {
  it('changes the title without counting as an update and pushes the change', async () => {
    const { service, store, pushed, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const before = store.session(s.id)?.updatedAt
    service.rename(s.id, '  幂等\n校验 ')
    expect(store.session(s.id)).toMatchObject({ title: '幂等 校验', updatedAt: before })
    expect(pushed.at(-1)).toMatchObject({
      channel: 'session.changed',
      payload: { id: s.id, title: '幂等 校验' },
    })
  })

  it('finds the session by the new title', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    service.rename(s.id, '独一无二的标题')
    expect(service.search('独一无二').map((h) => h.session.id)).toEqual([s.id])
  })

  it('refuses an empty title and an unknown session', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    expect(() => service.rename(s.id, '   ')).toThrow('不能为空')
    expect(() => service.rename('nope', '标题')).toThrow('没有这个会话')
  })
})

describe('SessionService search and remove', () => {
  it('indexes the user message and the reply once the turn is done', async () => {
    const { service, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const [hit] = service.search('幂等校验')
    expect(hit?.session.id).toBe(s.id)
  })

  it('refuses to remove a session that is still running', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    expect(() => service.remove(s.id)).toThrow(/先停止/)
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    await vi.waitFor(() => expect(service.isRunning(s.id)).toBe(false))
    service.remove(s.id)
    expect(store.session(s.id)).toBeUndefined()
  })
})

describe('SessionService compact', () => {
  it('stores the summary as a compaction part and restarts the context from it', async () => {
    const { service, waitFor, store } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    await service.compact(s.id)
    const detail = store.detail(s.id)
    const part = detail?.parts.find((p) => p.type === 'compaction')
    expect(part?.status).toBe('completed')
    expect(part?.payload).toMatchObject({ summary: expect.stringContaining('@idempotent') })
    expect(detail?.messages.at(-1)).toMatchObject({
      finishReason: 'compaction',
      contextTokens: 1_200,
    })
    expect(store.session(s.id)?.status).toBe('done')
  })

  it('refuses to compact while a turn is running', async () => {
    const { service, waitFor } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await expect(service.compact(s.id)).rejects.toThrow(/还在跑/)
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('sends a message typed during compaction after it', async () => {
    const { service, waitFor, store } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const compacting = service.compact(s.id)
    await service.prompt(s.id, '接着做')
    expect(service.isRunning(s.id)).toBe(false)
    await compacting
    await waitFor(s.id, ['done'])
    await vi.waitFor(() =>
      expect(store.detail(s.id)?.messages.filter((m) => m.role === 'user')).toHaveLength(2),
    )
  })
})

describe('SessionService removeWorkdir', () => {
  it('removes every session of the directory and leaves the others', async () => {
    const { service, store, waitFor } = setup('done')
    const a = await service.create(input)
    const b = await service.create({ ...input, workdir: '/w/' })
    const other = await service.create({ ...input, workdir: '/other' })
    await waitFor(a.id, ['done'])
    await waitFor(b.id, ['done'])
    await waitFor(other.id, ['done'])
    service.removeWorkdir('/w')
    expect(store.list().map((s) => s.id)).toEqual([other.id])
    expect(store.detail(a.id)).toBeNull()
  })

  it('refuses while a session of the directory is running and removes nothing', async () => {
    const { service, store, waitFor } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    expect(() => service.removeWorkdir('/w')).toThrow('有会话在运行')
    expect(store.session(s.id)).toBeTruthy()
    await service.abort(s.id)
  })

  it('keeps all sessions when a delete fails halfway', async () => {
    const { service, store, waitFor } = setup('done')
    const a = await service.create(input)
    await waitFor(a.id, ['done'])
    expect(() => store.removeAll([a.id, Symbol('bad') as unknown as string])).toThrow()
    expect(store.session(a.id)).toBeTruthy()
  })
})

describe('SessionService session settings', () => {
  it('saves the permission of a session that has not reached the kernel yet', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    store.updateSession(s.id, { kernelSessionId: '' })
    await service.setPermissionMode(s.id, 'auto')
    expect(store.session(s.id)?.permissionMode).toBe('auto')
    expect(kernel.permissionUpdates).toEqual([])
  })

  it('hands the whole new rule list to the kernel and leaves a notice', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const before = store.session(s.id)?.updatedAt
    await service.setPermissionMode(s.id, 'auto')
    expect(kernel.permissionUpdates).toHaveLength(1)
    expect(kernel.permissionUpdates[0]?.rules).toContainEqual({
      tool: 'bash',
      pattern: '*',
      level: 'allow',
    })
    expect(store.session(s.id)?.updatedAt).toBe(before)
    expect(store.detail(s.id)?.messages.at(-1)).toMatchObject({
      role: 'notice',
      text: 'permission:auto',
    })
  })

  it('does nothing when the permission does not change', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    await service.setPermissionMode(s.id, 'ask')
    expect(kernel.permissionUpdates).toEqual([])
    expect(store.detail(s.id)?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('keeps the old permission when the kernel refuses the change', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    vi.spyOn(kernel, 'setPermission').mockRejectedValue(new Error('boom'))
    await expect(service.setPermissionMode(s.id, 'auto')).rejects.toThrow('boom')
    expect(store.session(s.id)?.permissionMode).toBe('ask')
  })

  it('answers a request the kernel raised after the session was switched to auto', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    const reply = vi.spyOn(kernel, 'respondPermission')
    vi.spyOn(kernel, 'prompt').mockImplementation(async function* () {
      await service.setPermissionMode(s.id, 'auto')
      yield {
        type: 'permission-request',
        requestId: 'r1',
        tool: 'bash',
        input: {},
        patterns: ['ls'],
        always: [],
      }
      yield { type: 'done', reason: 'completed' }
    })
    await service.prompt(s.id, '再来')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.anything(), 'r1', 'once'))
    await waitFor(s.id, ['done'])
    expect(store.detail(s.id)?.parts.some((p) => p.type === 'permission')).toBe(false)
  })

  it('sends the next message with the new model and keeps the running turn as it was', async () => {
    const { service, store, kernel, waitFor } = setup('done')
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    service.setModel(s.id, 'corp/fast')
    expect(store.detail(s.id)?.messages.at(-1)).toMatchObject({
      role: 'notice',
      text: 'model:corp/fast',
    })
    const prompt = vi.spyOn(kernel, 'prompt')
    await service.prompt(s.id, '再来')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled())
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({ model: 'corp/fast' })
    await waitFor(s.id, ['done'])
  })
})

describe('exportName', () => {
  it('drops characters that cannot go into a file name', () => {
    const at = new Date(2026, 10, 4).getTime()
    expect(exportName('a/b: c?', at)).toBe('20261104-a-b-c')
    expect(exportName('', at)).toBe('20261104-产出')
  })
})

describe('SessionService diff refresh order', () => {
  it('drops a slow diff result of an earlier turn that comes back after the newer one', async () => {
    const { service, waitFor, store, kernel } = setup('done', undefined, [0])
    const real = kernel.diff.bind(kernel)
    let calls = 0
    vi.spyOn(kernel, 'diff').mockImplementation(async (ks) => {
      calls += 1
      const result = await real(ks)
      // 第一轮的那次刷新很慢，第二轮的先回来
      if (calls === 1) await new Promise((r) => setTimeout(r, 80))
      return result
    })
    const s = await service.create(input)
    await waitFor(s.id, ['done'])
    await service.prompt(s.id, '再改一遍')
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    await waitFor(s.id, ['done'])
    await vi.waitFor(() => expect(service.diffs(s.id).map((d) => d.turn)).toEqual([1, 2]))
    await new Promise((r) => setTimeout(r, 120))
    expect(service.diffs(s.id).map((d) => d.turn)).toEqual([1, 2])
  })
})

describe('SessionService kernel reads', () => {
  it('releases the kernel even when reading the diff never returns', async () => {
    const db = openDatabase(':memory:', migrations)
    close = db.close
    exportsDir = mkdtempSync(path.join(os.tmpdir(), 'kits-exports-'))
    const store = new SessionStore(db.db)
    const kernel = new MockKernel({ scenario: 'done', speed: 0 })
    vi.spyOn(kernel, 'diff').mockImplementation(() => new Promise(() => {}))
    const release = vi.fn()
    const service = new SessionService({
      store,
      kernels: { acquire: async () => kernel, release },
      resolveAgent: () => builtinAssistant,
      loadMcp: () => parseMcpFile({}),
      registry: { register: () => {} },
      push: () => {},
      flushMs: 5,
      diffDelays: [0],
      readTimeoutMs: 30,
      exportsDir,
      attachmentsDir: exportsDir,
    })
    const s = await service.create(input)
    await vi.waitFor(() => expect(store.session(s.id)?.status).toBe('done'))
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
  })
})

describe('titleOf', () => {
  it('folds whitespace and cuts at 40 characters', () => {
    expect(titleOf('  修 一下\n bug ')).toBe('修 一下 bug')
    expect(titleOf('字'.repeat(50))).toBe(`${'字'.repeat(40)}…`)
  })
})

describe('mergeDiffs', () => {
  it('adds up the changes of one file in one turn', () => {
    const diff = { turn: 1, path: 'a.ts', status: 'modified' as const }
    expect(
      mergeDiffs([
        { ...diff, additions: 1, deletions: 2, patch: 'one' },
        { ...diff, additions: 3, deletions: 0, patch: 'two' },
        { ...diff, turn: 2, additions: 1, deletions: 0, patch: 'three' },
      ]),
    ).toEqual([
      { ...diff, additions: 4, deletions: 2, patch: 'one\ntwo' },
      { ...diff, turn: 2, additions: 1, deletions: 0, patch: 'three' },
    ])
  })
})
