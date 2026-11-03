import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

// kits 工具服务的 HTTP 传输：MCP Streamable HTTP，只监听 127.0.0.1 的随机端口，每次启动随机 token，
// 内核在配置里带 `Authorization: Bearer <token>`（token 走环境变量，见 generate/opencode-config.ts）。
// 无状态模式：每个请求新建一个 McpServer 和传输，请求结束就关，阻塞的 ask_user 只占它自己那个请求。

export interface KitsToolHttpServer {
  url: string
  token: string
  close(): Promise<void>
}

export interface KitsToolHttpOptions {
  createServer(): McpServer
  token?: string
  port?: number
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? ''
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(header)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

export async function startKitsToolHttpServer(
  options: KitsToolHttpOptions,
): Promise<KitsToolHttpServer> {
  const token = options.token ?? randomBytes(24).toString('base64url')
  const http = createServer(async (req, res) => {
    // 不带 token 的请求也会走到这里，路径解析失败不能让异常冒出去把宿主进程带崩
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      return reject(res, 400, 'bad request')
    }
    if (pathname !== '/mcp') return reject(res, 404, 'not found')
    if (!authorized(req, token)) return reject(res, 401, 'unauthorized')
    // 无状态模式下没有服务端推送的 GET 流，也没有会话可删
    if (req.method !== 'POST') return reject(res, 405, 'method not allowed')
    const server = options.createServer()
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (e) {
      if (!res.headersSent) reject(res, 500, e instanceof Error ? e.message : String(e))
    }
  })
  // 阻塞提问可能等很久，不让 Node 的默认超时把请求掐掉
  http.requestTimeout = 0
  http.headersTimeout = 60_000
  await new Promise<void>((resolve, rejectListen) => {
    http.once('error', rejectListen)
    http.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const { port } = http.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () =>
      new Promise((resolve) => {
        http.closeAllConnections()
        http.close(() => resolve())
      }),
  }
}
