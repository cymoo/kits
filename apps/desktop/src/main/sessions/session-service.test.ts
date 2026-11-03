import path from 'node:path'
import { builtinAssistant, type PushEvents, parseMcpFile, type SessionStatus } from '@kits/core'
import { MockKernel, type MockScenarioName } from '@kits/kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db'
import { ConfigProblemsError } from '../kernel/kernel-manager'
import { SessionService, titleOf } from './session-service'
import { SessionStore } from './session-store'

const migrations = path.resolve(import.meta.dirname, '../../../drizzle')
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
})

// gate：内核启动卡住，直到调用 open（模拟真实内核冷启动）
function setup(scenario: MockScenarioName | 'broken', gate?: Promise<void>) {
  const db = openDatabase(':memory:', migrations)
  close = db.close
  const store = new SessionStore(db.db)
  const pushed: { channel: keyof PushEvents; payload: unknown }[] = []
  // Mock 内核的 ask_user 走会话服务，和应用里一样
  let service: SessionService | undefined
  const kernel = new MockKernel({
    scenario: scenario === 'broken' ? 'done' : scenario,
    speed: 0,
    tools: {
      askUser: (i, ctx) => (service as SessionService).askUser(i, ctx),
      onOutput: async () => {},
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
    resolveAgent: () => builtinAssistant,
    loadMcp: () => parseMcpFile({}),
    registry: { register: (...args: unknown[]) => void registered.push(args) },
    push: (channel, payload) => void pushed.push({ channel, payload }),
    flushMs: 5,
  })
  const statusOf = (id: string) => store.session(id)?.status
  const waitFor = (id: string, statuses: SessionStatus[]) =>
    vi.waitFor(() => expect(statuses).toContain(statusOf(id)), { timeout: 3_000 })
  return { service, store, pushed, kernel, waitFor, registered }
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
    expect(types).toEqual(['reasoning', 'tool', 'tool', 'text'])
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
    await service.respondPermission({ id: s.id, requestId: 'per_1', reply: 'once' })
    await waitFor(s.id, ['done'])
    const perm = store.detail(s.id)?.parts.find((p) => p.type === 'permission')
    expect(perm?.status).toBe('once')
  })

  it('logs every permission decision', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    const log = vi.spyOn(store, 'logPermission')
    await service.respondPermission({ id: s.id, requestId: 'per_1', reply: 'always' })
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
      requestId: 'per_1',
      reply: 'reject',
      message: '  先别跑测试  ',
    })
    await waitFor(s.id, ['done'])
    const perm = store.detail(s.id)?.parts.find((p) => p.type === 'permission')
    expect(perm).toMatchObject({ status: 'reject', payload: { message: '先别跑测试' } })
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
      { question: '用哪个库？', options: ['测试库', '本地库'], assumption: '测试库', blocking: false },
      { sessionId: s.id },
    )
    expect(result).toEqual({ answered: false, assumption: '测试库' })
    await service.respondPermission({ id: s.id, requestId: 'per_1', reply: 'once' })
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
    expect(service.get(s.id)?.session.queued).toEqual(['顺便看下日志', '改完提交'])
    expect(pushed.at(-1)?.payload).toMatchObject({ queued: ['顺便看下日志', '改完提交'] })
    await service.respondPermission({ id: s.id, requestId: 'per_1', reply: 'once' })
    await vi.waitFor(() => expect(store.session(s.id)?.turns).toBe(2))
    expect(store.detail(s.id)?.messages.at(-2)?.text).toBe('顺便看下日志\n\n改完提交')
    expect(service.get(s.id)?.session.queued).toBeUndefined()
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
  })

  it('drops queued follow-ups when the turn is stopped', async () => {
    const { service, waitFor, store } = setup('permission')
    const s = await service.create(input)
    await waitFor(s.id, ['waiting'])
    await service.prompt(s.id, '顺便看下日志')
    await service.abort(s.id)
    await waitFor(s.id, ['aborted'])
    await new Promise((r) => setTimeout(r, 50))
    expect(store.session(s.id)?.turns).toBe(1)
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
    expect(service.get(s.id)?.session.queued).toEqual(['再来一轮'])
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

describe('titleOf', () => {
  it('folds whitespace and cuts at 40 characters', () => {
    expect(titleOf('  修 一下\n bug ')).toBe('修 一下 bug')
    expect(titleOf('字'.repeat(50))).toBe(`${'字'.repeat(40)}…`)
  })
})
