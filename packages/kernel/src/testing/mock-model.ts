import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// OpenAI 兼容的假网关（phase1-implementation 4.5 节），契约测试用，不调真实模型。
// 按请求内容决定回什么，不依赖调用次数，内核额外发的请求（生成标题等）也能应付：
// - 请求里没有 tools：回一句固定文本（内核生成标题、摘要时走这里）；
// - 最后一条是 tool 结果：回文本，把工具输出带上，便于断言；
// - 否则：调一次工具（默认 bash，命令不在只读白名单里，保证触发权限请求）。

export interface MockModelOptions {
  toolCall?: { name: string; arguments: Record<string, unknown> }
  // 按请求选工具，优先于 toolCall：子任务要主会话和子会话调不同的工具
  pickTool?: (body: ChatRequest) => { name: string; arguments: Record<string, unknown> }
  // 前 N 个带 tools 的请求直接回 503，触发内核重试
  failFirst?: number
  // 每个请求先等这么久再吐第一个字节（模拟网关首字延迟，测 abort 用）
  firstByteDelayMs?: number
}

export interface ChatRequest {
  model?: string
  stream?: boolean
  tools?: unknown[]
  messages?: { role: string; content?: unknown }[]
}

export interface MockModel {
  baseUrl: string
  requests: ChatRequest[]
  close(): Promise<void>
}

export const MOCK_MODEL_ID = 'mock-model'
export const MOCK_TITLE = 'kits 契约测试'

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  const body = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 0,
    model: MOCK_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
  return `data: ${JSON.stringify(body)}\n\n`
}

function usage(): string {
  const body = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 0,
    model: MOCK_MODEL_ID,
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
  }
  return `data: ${JSON.stringify(body)}\n\n`
}

async function readJson(req: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
  } catch {
    return {}
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'object' && c && 'text' in c ? String(c.text) : ''))
      .join('')
  }
  return ''
}

export async function startMockModel(options: MockModelOptions = {}): Promise<MockModel> {
  const requests: ChatRequest[] = []
  let failures = options.failFirst ?? 0
  const toolCall = options.toolCall ?? {
    name: 'bash',
    arguments: { command: "printf 'hi'", description: 'Print hi' },
  }

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL_ID, object: 'model' }] }))
      return
    }
    if (req.method !== 'POST' || !url.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const body = await readJson(req)
    requests.push(body)
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0
    if (hasTools && failures > 0) {
      failures -= 1
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ error: { message: 'mock gateway unavailable', type: 'server_error' } }),
      )
      return
    }
    if (options.firstByteDelayMs) {
      await new Promise((r) => setTimeout(r, options.firstByteDelayMs))
      if (res.destroyed) return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const last = body.messages?.at(-1)
    if (!hasTools) {
      res.write(chunk({ role: 'assistant', content: MOCK_TITLE }))
      res.write(chunk({}, 'stop'))
    } else if (last?.role === 'tool') {
      res.write(chunk({ role: 'assistant', reasoning_content: '命令跑完了，' }))
      res.write(chunk({ reasoning_content: '汇报结果。' }))
      res.write(chunk({ content: '命令输出：' }))
      res.write(chunk({ content: textOf(last.content).trim() }))
      res.write(chunk({}, 'stop'))
    } else {
      const picked = options.pickTool?.(body) ?? toolCall
      res.write(
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_mock_1',
              type: 'function',
              function: { name: picked.name, arguments: JSON.stringify(picked.arguments) },
            },
          ],
        }),
      )
      res.write(chunk({}, 'tool_calls'))
    }
    res.write(usage())
    res.end('data: [DONE]\n\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
