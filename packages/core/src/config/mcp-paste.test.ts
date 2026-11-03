import { describe, expect, it } from 'vitest'
import { parseMcpPaste, serverVars, toMcpServersEntry } from './mcp-paste'

describe('parseMcpPaste', () => {
  it('reads the mcpServers format of Claude and Cursor', () => {
    const r = parseMcpPaste(
      JSON.stringify({
        mcpServers: {
          'case-platform': {
            url: 'https://cases.corp.example/mcp',
            headers: { Authorization: 'Bearer ${CASE_TOKEN}' },
          },
          wiki: { command: 'npx', args: ['-y', 'wiki-mcp'] },
        },
      }),
    )
    expect(r.ok && Object.entries(r.servers).map(([n, s]) => [n, s.type])).toEqual([
      ['case-platform', 'http'],
      ['wiki', 'stdio'],
    ])
  })

  it('converts the local and remote servers of OpenCode', () => {
    const r = parseMcpPaste(
      JSON.stringify({
        mcp: {
          gitlab: {
            type: 'local',
            command: ['npx', 'gitlab-mcp'],
            environment: { TOKEN: '${GL}' },
          },
          req: { type: 'remote', url: 'https://req.corp/mcp', enabled: false },
        },
      }),
    )
    expect(r).toMatchObject({
      ok: true,
      servers: {
        gitlab: { type: 'stdio', command: 'npx', args: ['gitlab-mcp'], env: { TOKEN: '${GL}' } },
        req: { type: 'http', url: 'https://req.corp/mcp', enabled: false },
      },
    })
  })

  it('accepts a bare name to server map', () => {
    const r = parseMcpPaste('{ "wiki": { "command": "wiki-mcp" } }')
    expect(r.ok && r.servers.wiki?.type).toBe('stdio')
  })

  it('says what is wrong with broken input', () => {
    expect(parseMcpPaste('{ mcpServers')).toEqual({ ok: false, error: '不是合法的 JSON' })
    expect(parseMcpPaste('{"mcpServers":{"a b":{"command":"x"}}}')).toMatchObject({ ok: false })
    expect(parseMcpPaste('{"mcpServers":{"x":{"url":"file:///etc"}}}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('x'),
    })
    expect(parseMcpPaste('{"mcpServers":{}}')).toEqual({ ok: false, error: '没有找到服务' })
  })
})

describe('serverVars', () => {
  it('lists the placeholders of url, headers, args and env once each', () => {
    const r = parseMcpPaste(
      JSON.stringify({
        a: { url: 'https://${HOST}/mcp', headers: { A: '${TOKEN}', B: 'x ${TOKEN}' } },
        b: { command: 'run', args: ['--key', '${KEY}'], env: { T: '${TOKEN}' } },
      }),
    )
    expect(r.ok && serverVars(r.servers.a as never)).toEqual(['HOST', 'TOKEN'])
    expect(r.ok && serverVars(r.servers.b as never)).toEqual(['KEY', 'TOKEN'])
  })
})

describe('toMcpServersEntry', () => {
  it('writes the common format back without empty fields', () => {
    const r = parseMcpPaste('{"wiki":{"command":"wiki-mcp"},"h":{"url":"https://h/mcp"}}')
    expect(r.ok && toMcpServersEntry(r.servers.wiki as never)).toEqual({ command: 'wiki-mcp' })
    expect(r.ok && toMcpServersEntry(r.servers.h as never)).toEqual({
      type: 'http',
      url: 'https://h/mcp',
    })
  })
})
