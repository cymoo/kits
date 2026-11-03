import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// E2E 用的假网关：只实现 GET /models，校验 Bearer key。对话接口不需要（不起内核）。
export async function startFakeGateway(models: string[], key = 'sk-test') {
  const server: Server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      if (req.headers.authorization !== `Bearer ${key}`) {
        res.writeHead(401).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }),
      )
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    // 主机名用 localhost，网关 id 会从它取
    baseUrl: `http://localhost:${port}/v1`,
    key,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
