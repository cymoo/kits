import { describe, expect, it } from 'vitest'
import { parseMcpConfig } from './mcp'

describe('parseMcpConfig', () => {
  it('treats an entry with command as a stdio server', () => {
    const servers = parseMcpConfig({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
    })
    expect(servers.fs).toMatchObject({ type: 'stdio', command: 'npx', enabled: true })
  })

  it('treats an entry with url as an http server', () => {
    const servers = parseMcpConfig({
      mcpServers: { jira: { url: 'http://jira.local/mcp', headers: { Authorization: 'x' } } },
    })
    expect(servers.jira).toMatchObject({ type: 'http', url: 'http://jira.local/mcp' })
  })

  it('maps streamable-http to http', () => {
    const servers = parseMcpConfig({
      mcpServers: { a: { type: 'streamable-http', url: 'http://a.local/mcp' } },
    })
    expect(servers.a?.type).toBe('http')
  })

  it('rejects a server with neither command nor url', () => {
    expect(() => parseMcpConfig({ mcpServers: { bad: {} } })).toThrow()
  })
})
