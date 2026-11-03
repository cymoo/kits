import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallRegistry } from './correlation'
import { type KitsToolHttpServer, startKitsToolHttpServer } from './http-transport'
import { createKitsToolServer, type KitsToolHandlers } from './server'

const schema = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } }

function setup(overrides: Partial<KitsToolHandlers> = {}) {
  const calls: { tool: string; input: unknown; sessionId: string | undefined }[] = []
  const handlers: KitsToolHandlers = {
    askUser: async (input, ctx) => {
      calls.push({ tool: 'ask_user', input, sessionId: ctx.sessionId })
      return { answered: false, ...(input.assumption ? { assumption: input.assumption } : {}) }
    },
    outputSchema: (ctx) => (ctx.sessionId === 'with-schema' ? schema : undefined),
    onOutput: async (output, ctx) => {
      calls.push({ tool: 'submit_output', input: output, sessionId: ctx.sessionId })
    },
    remember: async (input, ctx) => {
      calls.push({ tool: 'remember', input, sessionId: ctx.sessionId })
    },
    ...overrides,
  }
  return { calls, handlers }
}

async function connect(handlers: KitsToolHandlers, sessionId: string | undefined) {
  const server = createKitsToolServer({ handlers, resolveSession: async () => sessionId })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return client
}

const textOf = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? ''

describe('createKitsToolServer', () => {
  it('offers ask_user, submit_output and remember', async () => {
    const client = await connect(setup().handlers, 's1')
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'ask_user',
      'submit_output',
      'remember',
    ])
  })

  it('hands the resolved session to the ask_user handler', async () => {
    const { calls, handlers } = setup()
    const client = await connect(handlers, 's1')
    const r = await client.callTool({
      name: 'ask_user',
      arguments: { question: '用哪个环境？', assumption: '测试环境' },
    })
    expect(JSON.parse(textOf(r))).toEqual({ answered: false, assumption: '测试环境' })
    expect(calls).toEqual([
      {
        tool: 'ask_user',
        input: { question: '用哪个环境？', assumption: '测试环境', blocking: false },
        sessionId: 's1',
      },
    ])
  })

  it('validates submit_output against the schema of the session agent', async () => {
    const { calls, handlers } = setup()
    const client = await connect(handlers, 'with-schema')
    const bad = await client.callTool({ name: 'submit_output', arguments: { output: {} } })
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toContain('不符合格式')
    const good = await client.callTool({ name: 'submit_output', arguments: { output: { n: 1 } } })
    expect(good.isError).toBeFalsy()
    expect(calls).toEqual([{ tool: 'submit_output', input: { n: 1 }, sessionId: 'with-schema' }])
  })

  it('rejects submit_output when the session agent has no output schema', async () => {
    const { calls, handlers } = setup()
    const client = await connect(handlers, 'plain')
    const r = await client.callTool({ name: 'submit_output', arguments: { output: { n: 1 } } })
    expect(r.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it('defaults remember to the project scope', async () => {
    const { calls, handlers } = setup()
    const client = await connect(handlers, 's1')
    await client.callTool({ name: 'remember', arguments: { text: '测试命令是 pnpm test' } })
    expect(calls[0]).toEqual({
      tool: 'remember',
      input: { text: '测试命令是 pnpm test', scope: 'project' },
      sessionId: 's1',
    })
  })
})

describe('ToolCallRegistry', () => {
  it('matches a call to the session that registered the same input', async () => {
    const registry = new ToolCallRegistry()
    registry.register('s1', 'ask_user', { question: 'a' })
    registry.register('s2', 'ask_user', { question: 'b' })
    expect(await registry.match('ask_user', { question: 'b' }, 0)).toBe('s2')
    expect(await registry.match('ask_user', { question: 'a' }, 0)).toBe('s1')
  })

  it('ignores key order and defaults the server fills in', async () => {
    const registry = new ToolCallRegistry()
    registry.register('s1', 'ask_user', { options: ['x'], question: 'q' })
    expect(
      await registry.match('ask_user', { question: 'q', options: ['x'], blocking: false }, 0),
    ).toBe('s1')
  })

  it('waits for a registration that arrives after the call', async () => {
    const registry = new ToolCallRegistry()
    const pending = registry.match('remember', { text: 't' }, 1_000)
    setTimeout(() => registry.register('s3', 'remember', { text: 't' }), 20)
    expect(await pending).toBe('s3')
  })

  it('gives up after the wait and forgets registrations older than the ttl', async () => {
    let now = 0
    const registry = new ToolCallRegistry({ ttlMs: 10_000, now: () => now })
    registry.register('s1', 'ask_user', { question: 'q' })
    now = 10_001
    expect(await registry.match('ask_user', { question: 'q' }, 10)).toBeUndefined()
  })

  it('drops expired registrations of other inputs when registering', () => {
    let now = 0
    const registry = new ToolCallRegistry({ ttlMs: 10_000, now: () => now })
    registry.register('s1', 'ask_user', { question: 'old' })
    now = 10_001
    registry.register('s2', 'ask_user', { question: 'new' })
    expect(registry.size).toBe(1)
  })

  it('pairs two sessions asking the same thing in order', async () => {
    const registry = new ToolCallRegistry()
    registry.register('s1', 'ask_user', { question: 'q' })
    registry.register('s2', 'ask_user', { question: 'q' })
    expect(await registry.match('ask_user', { question: 'q' }, 0)).toBe('s1')
    expect(await registry.match('ask_user', { question: 'q' }, 0)).toBe('s2')
  })
})

describe('startKitsToolHttpServer', () => {
  let http: KitsToolHttpServer | undefined
  afterEach(async () => {
    await http?.close()
    http = undefined
  })

  async function start(handlers: KitsToolHandlers) {
    http = await startKitsToolHttpServer({
      createServer: () => createKitsToolServer({ handlers, resolveSession: async () => 's1' }),
    })
    return http
  }

  it('listens on localhost and rejects requests without the token', async () => {
    const server = await start(setup().handlers)
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const res = await fetch(server.url, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    const wrong = await fetch(server.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer nope' },
      body: '{}',
    })
    expect(wrong.status).toBe(401)
  })

  it('answers a malformed request path with 400 instead of crashing', async () => {
    const server = await start(setup().handlers)
    const { port } = new URL(server.url)
    // fetch 会把路径规范化，这里直接写原始请求行
    const net = await import('node:net')
    const reply = await new Promise<string>((resolve) => {
      const socket = net.connect(Number(port), '127.0.0.1', () => {
        socket.write(
          'POST //[ HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        )
      })
      let data = ''
      socket.on('data', (c) => {
        data += c.toString()
      })
      socket.on('end', () => resolve(data))
    })
    expect(reply.split('\r\n')[0]).toContain('400')
  })

  it('serves the tools to an MCP client that sends the bearer token', async () => {
    const { calls, handlers } = setup()
    const server = await start(handlers)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${server.token}` } },
      }),
    )
    expect((await client.listTools()).tools).toHaveLength(3)
    await client.callTool({ name: 'remember', arguments: { text: 'x', scope: 'personal' } })
    expect(calls).toEqual([
      { tool: 'remember', input: { text: 'x', scope: 'personal' }, sessionId: 's1' },
    ])
    await client.close()
  })
})
