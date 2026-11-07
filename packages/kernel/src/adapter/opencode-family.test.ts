import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { KernelEvent } from '@kits/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelDialect, KernelExit, KernelSession } from '../kernel'
import { composeParts, OpencodeFamilyKernel, type OpencodeFamilyOptions } from './opencode-family'

// 用一个最小的假内核测适配器自己的逻辑：session.idle 丢了靠轮询收尾、事件流断了重连并补齐、卡死判定。
// 真实内核的行为由 opencode-family.contract.test.ts 覆盖。

interface Fake {
  url: string
  // 当前连着的事件流
  streams: ServerResponse[]
  // 一共连过几次（断线重连后加一）
  connections: number
  // GET /session/status 返回的状态；hangStatus 时不回
  status: Record<string, { type: string }>
  hangStatus: boolean
  // GET /session/{id}/message 的内容，和回之前等多久
  messages: unknown[]
  // 子会话的消息，按会话 id
  subMessages: Record<string, unknown[]>
  messagesDelayMs: number
  messageRequests: number
  // GET /permission；failPermissions 时回 500
  permissions: unknown[]
  failPermissions: boolean
  // POST /session/{id}/abort 不回
  hangAbort: boolean
  // POST prompt_async 不回
  hangPrompt: boolean
  // 事件流连上后不发 server.connected
  silentStream: boolean
  promptCount: number
  aborts: number
  promptBody: unknown
  summarizeBody: unknown
  close(): Promise<void>
}

async function startFake(): Promise<Fake> {
  const fake: Omit<Fake, 'url' | 'close'> = {
    streams: [],
    connections: 0,
    status: {},
    hangStatus: false,
    messages: [],
    subMessages: {},
    messagesDelayMs: 0,
    messageRequests: 0,
    permissions: [],
    failPermissions: false,
    hangAbort: false,
    hangPrompt: false,
    silentStream: false,
    promptCount: 0,
    aborts: 0,
    promptBody: undefined,
    summarizeBody: undefined,
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (!fake.silentStream) {
        res.write(`data: ${JSON.stringify({ type: 'server.connected', properties: {} })}\n\n`)
      }
      fake.streams.push(res)
      fake.connections += 1
      req.on('close', () => {
        fake.streams = fake.streams.filter((s) => s !== res)
      })
      return
    }
    const json = (v: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(v))
    }
    if (url.pathname === '/session' && req.method === 'POST') return json({ id: 'ses_1' })
    if (url.pathname.endsWith('/prompt_async')) {
      fake.promptCount += 1
      if (fake.hangPrompt) return
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      fake.promptBody = JSON.parse(Buffer.concat(chunks).toString())
      res.writeHead(204).end()
      return
    }
    if (url.pathname === '/session/status') {
      if (fake.hangStatus) return
      return json(fake.status)
    }
    if (url.pathname.endsWith('/message')) {
      fake.messageRequests += 1
      const sub = url.pathname.split('/')[2] ?? ''
      const snapshot = fake.subMessages[sub] ?? fake.messages
      if (fake.messagesDelayMs) await new Promise((r) => setTimeout(r, fake.messagesDelayMs))
      return json(snapshot)
    }
    if (url.pathname === '/permission') {
      if (fake.failPermissions) {
        res.writeHead(500).end()
        return
      }
      return json(fake.permissions)
    }
    if (url.pathname.endsWith('/abort')) {
      fake.aborts += 1
      if (fake.hangAbort) return
      return json(true)
    }
    if (url.pathname.endsWith('/summarize')) {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      fake.summarizeBody = JSON.parse(Buffer.concat(chunks).toString())
      return json(true)
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  }) as Fake
}

function send(fake: Fake, type: string, properties: Record<string, unknown>) {
  for (const s of fake.streams) s.write(`data: ${JSON.stringify({ type, properties })}\n\n`)
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  if (!cond()) throw new Error('condition not met')
}

let fake: Fake
let kernel: OpencodeFamilyKernel
let exitListener: ((exit: KernelExit) => void) | undefined

async function setup(options: OpencodeFamilyOptions = {}): Promise<KernelSession> {
  fake = await startFake()
  const dialect: KernelDialect = {
    id: 'opencode',
    apiPrefix: '',
    permissionListPath: '/permission',
    interject: true,
    projectInstructions: false,
    spawn: async () => ({
      baseUrl: fake.url,
      headers: {},
      close: async () => {},
      onExit: (l) => {
        exitListener = l
      },
    }),
    writeConfig: async () => {},
    permissionReplyPath: (id) => `/permission/${id}/reply`,
  }
  kernel = new OpencodeFamilyKernel(dialect, {
    pollIntervalMs: 50,
    reconnectDelayMs: 20,
    ...options,
  })
  await kernel.start({ binary: '', configDir: '', dataDir: '', env: {} })
  return kernel.createSession({ workdir: '/w', agent: 'assistant', permission: [] })
}

afterEach(async () => {
  await kernel?.dispose()
  await fake?.close()
})

async function collect(
  iter: AsyncIterable<KernelEvent>,
  during: (events: KernelEvent[]) => Promise<void>,
) {
  const events: KernelEvent[] = []
  const done = (async () => {
    for await (const e of iter) events.push(e)
  })()
  await during(events)
  await done
  return events
}

const text = (events: KernelEvent[]) =>
  events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')

const assistant = { sessionID: 'ses_1', info: { id: 'msg_a', role: 'assistant' } }
const delta = (d: string) => ({
  sessionID: 'ses_1',
  messageID: 'msg_a',
  partID: 'prt_1',
  field: 'text',
  delta: d,
})
const snapshot = (body: string) => [
  {
    info: { id: 'msg_a', role: 'assistant', time: { created: Date.now() } },
    parts: [{ id: 'prt_1', messageID: 'msg_a', type: 'text', text: body }],
  },
]

// 断开事件流，等适配器重连上
async function reconnect(seen: KernelEvent[], waitDelta = true) {
  if (waitDelta) await until(() => seen.some((e) => e.type === 'text-delta'))
  const before = fake.connections
  for (const stream of fake.streams) stream.destroy()
  await until(() => fake.connections > before)
}

describe('OpencodeFamilyKernel', () => {
  it('completes by polling when session.idle never arrives', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      await new Promise((r) => setTimeout(r, 120))
      // 内核做完了但 session.idle 丢了，状态接口里已经没有这个会话
      fake.status = {}
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('sends the extra system prompt with the message', async () => {
    const s = await setup()
    await collect(kernel.prompt(s, { text: 'hi', system: '只读，不改文件' }), async () => {
      await until(() => fake.promptBody !== undefined)
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(fake.promptBody).toMatchObject({ agent: 'kits-assistant', system: '只读，不改文件' })
  })

  it('reconnects the event stream and backfills parts it missed', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      send(fake, 'message.updated', assistant)
      send(fake, 'message.part.delta', delta('前半'))
      // 断线期间内核把后半段写完了
      fake.messages = snapshot('前半后半')
      await reconnect(seen)
      await until(() => text(seen) === '前半后半')
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(text(events)).toBe('前半后半')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('keeps live events in order while a slow snapshot is loading', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      send(fake, 'message.updated', assistant)
      send(fake, 'message.part.delta', delta('ab'))
      // 快照是 abcdef（断线漏了 cd，ef 在补齐期间实时到达），快照要过一会儿才回
      fake.messages = snapshot('abcdef')
      fake.messagesDelayMs = 200
      await reconnect(seen)
      send(fake, 'message.part.delta', delta('ef'))
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(text(events)).toBe('abcdef')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('backfills before finishing when the poll sees idle during a disconnect', async () => {
    const s = await setup({ reconnectDelayMs: 400 })
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      send(fake, 'message.updated', assistant)
      send(fake, 'message.part.delta', delta('前半'))
      await until(() => seen.some((e) => e.type === 'text-delta'))
      // 断开后内核做完了，重连还要等 400 ms，轮询先看到 idle
      fake.messages = snapshot('前半后半')
      for (const stream of fake.streams) stream.destroy()
      fake.status = {}
    })
    expect(text(events)).toBe('前半后半')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('does not replay messages of the previous turn after a reconnect', async () => {
    const s = await setup()
    // 上一轮的回复已经在内核里了
    fake.messages = [
      {
        info: { id: 'msg_old', role: 'assistant', time: { created: Date.now() } },
        parts: [{ id: 'prt_old', messageID: 'msg_old', type: 'text', text: '上一轮' }],
      },
    ]
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      send(fake, 'message.updated', assistant)
      send(fake, 'message.part.delta', delta('这一轮'))
      fake.messages = [...fake.messages, ...snapshot('这一轮')]
      await reconnect(seen)
      await until(() => fake.messageRequests >= 2)
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(text(events)).toBe('这一轮')
  })

  it('recovers a permission request that was asked while disconnected', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const asked = {
      id: 'per_1',
      sessionID: 'ses_1',
      permission: 'bash',
      patterns: ['npm test'],
      metadata: { command: 'npm test' },
      always: ['npm *'],
    }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      fake.permissions = [asked, { ...asked, id: 'per_other', sessionID: 'ses_2' }]
      await reconnect(seen, false)
      await until(() => seen.some((e) => e.type === 'permission-request'))
      // 实时事件后到也不会重复
      send(fake, 'permission.asked', asked)
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(events.filter((e) => e.type === 'permission-request')).toEqual([
      expect.objectContaining({ requestId: 'per_1', tool: 'bash' }),
    ])
  })

  it('recovers a subagent permission request from the message snapshot', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const asked = {
      id: 'per_c',
      sessionID: 'ses_child',
      permission: 'bash',
      patterns: ['touch x'],
      metadata: { command: 'touch x' },
      always: ['touch *'],
    }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      // 子会话的建立和权限请求都丢在断线里，只有主会话消息上的 task 工具带着子会话 id
      fake.messages = [
        {
          info: { id: 'msg_a', sessionID: 'ses_1', role: 'assistant' },
          parts: [
            {
              id: 'prt_t',
              messageID: 'msg_a',
              type: 'tool',
              tool: 'task',
              callID: 'call_t',
              state: { status: 'running', input: {}, metadata: { sessionId: 'ses_child' } },
            },
          ],
        },
      ]
      fake.subMessages = {
        ses_child: [
          {
            info: { id: 'msg_c', sessionID: 'ses_child', role: 'assistant' },
            parts: [
              {
                id: 'prt_c',
                messageID: 'msg_c',
                type: 'tool',
                tool: 'read',
                callID: 'call_c',
                state: { status: 'completed', input: {}, output: 'x' },
              },
            ],
          },
        ],
      }
      fake.permissions = [asked, { ...asked, id: 'per_other', sessionID: 'ses_2' }]
      await reconnect(seen, false)
      await until(() => seen.some((e) => e.type === 'permission-request'))
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(events.filter((e) => e.type === 'permission-request')).toEqual([
      expect.objectContaining({ requestId: 'per_c', subagent: true }),
    ])
    // 子任务的步骤也补回来了
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool-end', callId: 'call_t/call_c', output: 'x' }),
    )
  })

  it('stops a turn that keeps compacting without getting anywhere', async () => {
    const s = await setup()
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      for (let i = 0; i < 3; i++) send(fake, 'session.compacted', { sessionID: 'ses_1' })
    })
    expect(events.filter((e) => e.type === 'compaction')).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: expect.stringContaining('上下文窗口太小'),
    })
    await until(() => fake.aborts === 1)
  })

  it('keeps going when the agent uses tools between compactions', async () => {
    const s = await setup()
    const tool = (callID: string) => ({
      sessionID: 'ses_1',
      part: {
        id: `prt_${callID}`,
        messageID: 'msg_a',
        sessionID: 'ses_1',
        type: 'tool',
        tool: 'read',
        callID,
        state: { status: 'running', input: {} },
      },
    })
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      for (let i = 0; i < 4; i++) {
        send(fake, 'session.compacted', { sessionID: 'ses_1' })
        send(fake, 'message.part.updated', tool(`call_${i}`))
      }
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('reports a stall when neither the event stream nor the status endpoint answers', async () => {
    const s = await setup({ stallTimeoutMs: 200 })
    fake.hangStatus = true
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {})
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: expect.stringContaining('没有响应'),
    })
  })

  it('ends the turn with an error when the kernel cannot be reached', async () => {
    const s = await setup()
    await fake.close()
    const events: KernelEvent[] = []
    for await (const e of kernel.prompt(s, { text: 'hi' })) events.push(e)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'done', reason: 'error' })
  })
  it('ends running turns with an error when the kernel process exits', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const exits: KernelExit[] = []
    kernel.onExit((e) => exits.push(e))
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      exitListener?.({ code: 1, signal: null, tail: 'panic: boom' })
    })
    expect(events.at(-1)).toEqual({
      type: 'done',
      reason: 'error',
      error: '内核进程退出了（退出码 1）\npanic: boom',
    })
    expect(exits).toHaveLength(1)
  })

  it('ends the turn when the process exits before the first event arrives', async () => {
    const s = await setup({ setupTimeoutMs: 5_000 })
    fake.silentStream = true
    const started = Date.now()
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.streams.length === 1)
      exitListener?.({ code: 1, signal: null, tail: 'panic: early' })
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' })
    expect(events.at(-1)).toMatchObject({ error: expect.stringContaining('panic: early') })
    // 不用等建连超时
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('does not submit the turn when abort comes while it is still preparing', async () => {
    const s = await setup()
    // 读历史消息要 200 ms，期间用户点了停止
    fake.messagesDelayMs = 200
    const iter = kernel.prompt(s, { text: 'hi' })
    const events = await collect(iter, async () => {
      await new Promise((r) => setTimeout(r, 50))
      await kernel.abort(s)
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    expect(fake.promptCount).toBe(0)
  })

  it('ends with the error recorded on a message recovered after a disconnect', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      fake.messages = [
        {
          info: {
            id: 'msg_a',
            role: 'assistant',
            time: { created: Date.now(), completed: Date.now() },
            error: { name: 'APIError', data: { message: '网关返回 502' } },
          },
          parts: [],
        },
      ]
      await reconnect(seen, false)
      // session.error 丢在了断线里，轮询看到 idle 收尾
      fake.status = {}
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'error', error: '网关返回 502' })
  })

  it('keeps the message snapshot when the permission list fails', async () => {
    const s = await setup()
    fake.status = { ses_1: { type: 'busy' } }
    fake.failPermissions = true
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async (seen) => {
      await until(() => fake.promptCount === 1)
      send(fake, 'message.updated', assistant)
      send(fake, 'message.part.delta', delta('前半'))
      fake.messages = snapshot('前半后半')
      await reconnect(seen)
      await until(() => text(seen) === '前半后半')
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    expect(text(events)).toBe('前半后半')
  })

  it('ends an aborted turn after the grace period even if the abort request hangs', async () => {
    const s = await setup({ abortGraceMs: 100 })
    fake.status = { ses_1: { type: 'busy' } }
    fake.hangAbort = true
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      void kernel.abort(s).catch(() => {})
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
  })

  it('ends the turn on abort while prompt_async is still waiting for a reply', async () => {
    const s = await setup({ abortGraceMs: 2_000 })
    fake.hangPrompt = true
    const started = Date.now()
    const events = await collect(kernel.prompt(s, { text: 'hi' }), async () => {
      await until(() => fake.promptCount === 1)
      // abort 请求可能在用例结束、假内核关掉之后才失败，这里不关心它的结果
      void kernel.abort(s).catch(() => {})
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    // 不用等 abortGrace 兜底，取消请求后立刻结束
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it('gives up and drops the subscription when the event stream never sends a first event', async () => {
    const s = await setup({ setupTimeoutMs: 200 })
    fake.silentStream = true
    const events: KernelEvent[] = []
    for await (const e of kernel.prompt(s, { text: 'hi' })) events.push(e)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: '连不上内核的事件流',
    })
    // 没人订阅了，事件流连接被关掉
    await until(() => fake.streams.length === 0)
    expect(fake.promptCount).toBe(0)
  })

  it('numbers the turns of collected diffs by the user messages of the session', async () => {
    const s = await setup()
    const user = (id: string, diffs: unknown[]) => ({
      info: { id, role: 'user', summary: { diffs } },
      parts: [],
    })
    fake.messages = [
      user('msg_1', []),
      { info: { id: 'msg_1a', role: 'assistant' }, parts: [] },
      user('msg_2', [{ file: 'a.ts', patch: '@@', additions: 1, deletions: 0, status: 'added' }]),
    ]
    expect(await kernel.diff(s)).toEqual([
      expect.objectContaining({ path: 'a.ts', status: 'added', turn: 2, messageId: 'msg_2' }),
    ])
  })

  it('summarizes a session on the default model with the model of its last reply', async () => {
    const s = await setup()
    fake.messages = [
      { info: { id: 'm1', role: 'assistant', providerID: 'corp', modelID: 'm-1' }, parts: [] },
      { info: { id: 'm2', role: 'user' }, parts: [] },
    ]
    await kernel.summarize(s)
    expect(fake.summarizeBody).toEqual({ providerID: 'corp', modelID: 'm-1' })
  })

  it('returns the text and the size of the summary message', async () => {
    const s = await setup()
    fake.messages = [
      { info: { id: 'm1', role: 'assistant', providerID: 'corp', modelID: 'm-1' }, parts: [] },
      {
        info: { id: 'm2', role: 'assistant', summary: true, tokens: { output: 900 } },
        parts: [
          { type: 'text', text: '## 任务\n加幂等校验' },
          { type: 'text', text: '继续', synthetic: true },
        ],
      },
    ]
    expect(await kernel.summarize(s)).toEqual({ summary: '## 任务\n加幂等校验', tokens: 900 })
  })
})

describe('composeParts', () => {
  it('sends text attachments as text and images as file parts', () => {
    expect(
      composeParts({
        text: '看这个',
        attachments: [
          { name: '需求.md', text: '# 需求' },
          { name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
        ],
      }),
    ).toEqual([
      { type: 'text', text: '看这个' },
      { type: 'text', text: '<attachment name="需求.md">\n# 需求\n</attachment>' },
      {
        type: 'file',
        mime: 'image/png',
        filename: 'shot.png',
        url: 'data:image/png;base64,AA==',
      },
    ])
  })
})
