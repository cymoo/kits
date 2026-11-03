import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { testGateway } from './gateway-client'

let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = undefined
})

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}

describe('testGateway', () => {
  it('lists the models sorted and deduplicated with the bearer key', async () => {
    let auth = ''
    const baseUrl = await serve((req, res) => {
      auth = req.headers.authorization ?? ''
      res.end(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 1 }] }))
    })
    const r = await testGateway({ baseUrl: `${baseUrl}/`, apiKey: 'sk' })
    expect(r).toMatchObject({ ok: true, models: ['a', 'b'] })
    expect(auth).toBe('Bearer sk')
  })

  it('explains an auth failure', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(401).end()
    })
    const r = await testGateway({ baseUrl })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('API Key') })
  })

  it('explains a refused connection', async () => {
    const baseUrl = await serve(() => {})
    await new Promise<void>((r) => server?.close(() => r()))
    server = undefined
    const r = await testGateway({ baseUrl })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('连不上') })
  })

  it('refuses a url that is not http or https', async () => {
    expect(await testGateway({ baseUrl: 'file:///etc' })).toMatchObject({ ok: false })
    expect(await testGateway({ baseUrl: 'not a url' })).toMatchObject({
      ok: false,
      error: '地址格式不对',
    })
  })
})
