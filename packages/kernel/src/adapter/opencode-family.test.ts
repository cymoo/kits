import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { KernelEvent } from '@kits/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelDialect, KernelExit, KernelSession } from '../kernel'
import { OpencodeFamilyKernel } from './opencode-family'

// 用一个最小的假内核测适配器自己的逻辑：session.idle 丢了靠轮询收尾、事件流断了重连并补齐。
// 真实内核的行为由 opencode-family.contract.test.ts 覆盖。

interface Fake {
  url: string
  // 当前连着的事件流
  streams: ServerResponse[]
  // 一共连过几次（断线重连后加一）
  connections: number
  // GET /session/status 返回的状态
  status: Record<string, { type: string }>
  messages: unknown[]
  promptCount: number
  close(): Promise<void>
}

async function startFake(): Promise<Fake> {
  const fake: Omit<Fake, 'url' | 'close'> = {
    streams: [],
    connections: 0,
    status: {},
    messages: [],
    promptCount: 0,
  }
  const server = createServer((req, res) => {
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
    if (url.pathname === '/session/status') return json(fake.status)
    if (url.pathname.endsWith('/message')) return json(fake.messages)
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
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}

let fake: Fake
let kernel: OpencodeFamilyKernel
let exitListener: ((exit: KernelExit) => void) | undefined

async function setup(): Promise<KernelSession> {
  fake = await startFake()
  const dialect: KernelDialect = {
    id: 'opencode',
    apiPrefix: '',
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
  kernel = new OpencodeFamilyKernel(dialect, { pollIntervalMs: 50, reconnectDelayMs: 20 })
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
      send(fake, 'message.updated', {
        sessionID: 'ses_1',
        info: { id: 'msg_a', role: 'assistant' },
      })
      send(fake, 'message.part.delta', {
        sessionID: 'ses_1',
        messageID: 'msg_a',
        partID: 'prt_1',
        field: 'text',
        delta: '前半',
      })
      // 等客户端真的收到前半段再断，不然断开时没发出去的数据会丢，测的就不是补齐了
      await until(() => seen.some((e) => e.type === 'text-delta'))
      // 断线期间内核把后半段写完了
      fake.messages = [
        {
          info: { id: 'msg_a', role: 'assistant', time: { created: Date.now() } },
          parts: [{ id: 'prt_1', messageID: 'msg_a', type: 'text', text: '前半后半' }],
        },
      ]
      const before = fake.connections
      for (const stream of fake.streams) stream.destroy()
      await until(() => fake.connections > before)
      await until(() => seen.filter((e) => e.type === 'text-delta').length >= 2)
      send(fake, 'session.idle', { sessionID: 'ses_1' })
    })
    const text = events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')
    expect(text).toBe('前半后半')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
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
})
