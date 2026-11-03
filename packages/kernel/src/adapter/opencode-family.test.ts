import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { KernelEvent } from '@kits/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelDialect, KernelSession } from '../kernel'
import { OpencodeFamilyKernel, type OpencodeFamilyOptions } from './opencode-family'

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
  messagesDelayMs: number
  messageRequests: number
  // GET /permission；failPermissions 时回 500
  permissions: unknown[]
  failPermissions: boolean
  // POST /session/{id}/abort 不回
  hangAbort: boolean
  promptCount: number
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
    messagesDelayMs: 0,
    messageRequests: 0,
    permissions: [],
    failPermissions: false,
    hangAbort: false,
    promptCount: 0,
    summarizeBody: undefined,
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ type: 'server.connected', properties: {} })}\n\n`)
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
      res.writeHead(204).end()
      return
    }
    if (url.pathname === '/session/status') {
      if (fake.hangStatus) return
      return json(fake.status)
    }
    if (url.pathname.endsWith('/message')) {
      fake.messageRequests += 1
      const snapshot = fake.messages
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

async function setup(options: OpencodeFamilyOptions = {}): Promise<KernelSession> {
  fake = await startFake()
  const dialect: KernelDialect = {
    id: 'opencode',
    apiPrefix: '',
    permissionListPath: '/permission',
    spawn: async () => ({ baseUrl: fake.url, headers: {}, close: async () => {} }),
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

  it('summarizes a session on the default model with the model of its last reply', async () => {
    const s = await setup()
    fake.messages = [
      { info: { id: 'm1', role: 'assistant', providerID: 'corp', modelID: 'm-1' }, parts: [] },
      { info: { id: 'm2', role: 'user' }, parts: [] },
    ]
    await kernel.summarize(s)
    expect(fake.summarizeBody).toEqual({ providerID: 'corp', modelID: 'm-1' })
  })
})
