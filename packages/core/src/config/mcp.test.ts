import { describe, expect, it } from 'vitest'
import { expandVars, parseMcpConfig, parseMcpFile } from './mcp'

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

  it('rejects an http server whose url is not http or https', () => {
    expect(() => parseMcpConfig({ mcpServers: { f: { url: 'file:///etc/passwd' } } })).toThrow()
    expect(() => parseMcpConfig({ mcpServers: { f: { url: 'ftp://a.local/x' } } })).toThrow()
  })

  it('rejects a server with neither command nor url', () => {
    expect(() => parseMcpConfig({ mcpServers: { bad: {} } })).toThrow()
  })
})

describe('parseMcpFile', () => {
  it('applies the kits enabled map on top of the pasted servers', () => {
    const file = parseMcpFile({
      mcpServers: { a: { url: 'http://a.local/mcp' }, b: { command: 'b' } },
      enabled: { a: false },
      permissions: { 'a.update_page': 'ask' },
    })
    expect(file.servers.a?.enabled).toBe(false)
    expect(file.servers.b?.enabled).toBe(true)
    expect(file.permissions).toEqual({ 'a.update_page': 'ask' })
  })

  it('accepts a missing file', () => {
    expect(parseMcpFile(undefined)).toEqual({ servers: {}, permissions: {} })
  })
})

describe('expandVars', () => {
  it('replaces placeholders and reports the ones it cannot find', () => {
    const lookup = (name: string) => (name === 'TOKEN' ? 't' : undefined)
    expect(expandVars('Bearer ${TOKEN} ${NOPE}', lookup)).toEqual({
      value: 'Bearer t ',
      missing: ['NOPE'],
    })
  })
})
