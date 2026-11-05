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

  it('reads the context window under the field names gateways use', async () => {
    const baseUrl = await serve((_req, res) => {
      res.end(
        JSON.stringify({
          data: [
            { id: 'deepseek', context_window: 1_048_576 },
            { id: 'openrouter', context_length: 200_000 },
            { id: 'vllm', max_model_len: 32_768 },
            { id: 'bad', context_window: '128k' },
            { id: 'plain' },
          ],
        }),
      )
    })
    const r = await testGateway({ baseUrl })
    expect(r).toMatchObject({
      ok: true,
      contextWindows: { deepseek: 1_048_576, openrouter: 200_000, vllm: 32_768 },
    })
    expect(r.ok && Object.keys(r.contextWindows)).toHaveLength(3)
  })

  it('reads string values and the anthropic max_input_tokens field', async () => {
    const baseUrl = await serve((_req, res) => {
      res.end(
        JSON.stringify({
          data: [
            { id: 'anthropic', max_input_tokens: 200_000 },
            { id: 'string', context_length: '65536' },
            { id: 'fraction', context_window: 128.5, max_model_len: 32_000 },
            { id: 'huge', context_window: 1_000_000_000, max_model_len: 16_000 },
          ],
        }),
      )
    })
    const r = await testGateway({ baseUrl })
    expect(r).toMatchObject({
      ok: true,
      contextWindows: { anthropic: 200_000, string: 65_536, fraction: 32_000, huge: 16_000 },
    })
  })

  it('probes the model detail endpoint when the list has no context window', async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }))
        return
      }
      if (req.url === '/v1/models/a') {
        res.end(JSON.stringify({ id: 'a', max_model_len: 65_536 }))
        return
      }
      res.end(JSON.stringify({ id: 'b', max_model_len: 32_000 }))
    })
    const r = await testGateway({ baseUrl })
    expect(r).toMatchObject({ ok: true, contextWindows: { a: 65_536, b: 32_000 } })
  })

  it('fails on a 200 reply that is not a model list', async () => {
    const baseUrl = await serve((_req, res) => {
      res.end(JSON.stringify({ error: { message: 'quota exceeded' } }))
    })
    expect(await testGateway({ baseUrl })).toMatchObject({
      ok: false,
      error: expect.stringContaining('data'),
    })
  })

  it('reports a connection dropped while reading the body instead of a bad model list', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '1000' })
      res.write('{"data": [')
      // 发了一半就断开
      setTimeout(() => res.destroy(), 20)
    })
    const r = await testGateway({ baseUrl })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/^连不上/)
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
