import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpService } from './mcp-service'

const echo = path.join(import.meta.dirname, 'fixtures', 'echo-server.mjs')

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'kits-mcp-'))
  file = path.join(dir, 'mcp.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function service(vars: Record<string, string> = {}) {
  const onChanged = vi.fn()
  const mcp = new McpService({
    file,
    lookupVar: (n) => vars[n],
    hasVar: (n) => n in vars,
    onChanged,
  })
  return { mcp, onChanged }
}

const read = () => JSON.parse(readFileSync(file, 'utf8'))

describe('McpService', () => {
  it('adds pasted servers in the common format and asks for a kernel restart', () => {
    const { mcp, onChanged } = service()
    const added = mcp.add(
      JSON.stringify({
        mcpServers: {
          cases: {
            url: 'https://cases.corp/mcp',
            headers: { Authorization: 'Bearer ${CASE_TOKEN}' },
          },
        },
      }),
    )
    expect(added).toEqual(['cases'])
    expect(read().mcpServers.cases).toEqual({
      type: 'http',
      url: 'https://cases.corp/mcp',
      headers: { Authorization: 'Bearer ${CASE_TOKEN}' },
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(mcp.overview().servers[0]).toMatchObject({
      name: 'cases',
      type: 'http',
      enabled: true,
      vars: [{ name: 'CASE_TOKEN', set: false }],
    })
  })

  it('keeps fields it does not know about when it writes the file', () => {
    writeFileSync(file, JSON.stringify({ mcpServers: {}, note: '人写的' }))
    const { mcp } = service()
    mcp.add('{"wiki":{"command":"wiki-mcp"}}')
    expect(read().note).toBe('人写的')
  })

  it('refuses to write over a broken file', () => {
    writeFileSync(file, '{ broken')
    const { mcp, onChanged } = service()
    expect(() => mcp.add('{"wiki":{"command":"wiki-mcp"}}')).toThrow('先手动修好')
    expect(readFileSync(file, 'utf8')).toBe('{ broken')
    expect(onChanged).not.toHaveBeenCalled()
    expect(mcp.overview().error).toContain('读不了')
  })

  it('turns a server off and on, sets a tool permission and removes everything of a server', () => {
    const { mcp } = service()
    mcp.add('{"wiki":{"command":"wiki-mcp"}}')
    mcp.setEnabled('wiki', false)
    expect(read().enabled).toEqual({ wiki: false })
    mcp.setEnabled('wiki', true)
    expect(read().enabled).toEqual({})
    mcp.setPermission('wiki', 'update_page', 'allow')
    expect(mcp.overview().servers[0]?.permissions).toEqual({ update_page: 'allow' })
    mcp.setPermission('wiki', 'update_page', null)
    expect(read().permissions).toEqual({})
    mcp.setPermission('wiki', 'update_page', 'deny')
    mcp.remove('wiki')
    expect(read()).toMatchObject({ mcpServers: {}, permissions: {} })
  })

  it('connects to a stdio server, lists its tools and guesses their default permissions', async () => {
    const { mcp } = service()
    mcp.add(JSON.stringify({ echo: { command: process.execPath, args: [echo] } }))
    mcp.setPermission('echo', 'get_case', 'deny')
    const result = await mcp.test('echo')
    expect(result).toMatchObject({ ok: true, tools: 2 })
    expect(mcp.overview().servers[0]?.tools).toEqual([
      { name: 'get_case', description: '读一条用例', level: 'deny' },
      { name: 'create_case', description: '新建一条用例', level: 'ask' },
    ])
    // 同名重新粘贴一份配置：旧的工具列表不作数，等重新测试
    mcp.add(JSON.stringify({ echo: { command: process.execPath, args: [echo, '--v2'] } }))
    expect(mcp.overview().servers[0]?.tools).toEqual([])
  }, 20_000)

  it('says which credentials are missing before trying to connect', async () => {
    const { mcp } = service()
    mcp.add('{"cases":{"url":"https://cases.corp/mcp","headers":{"A":"${CASE_TOKEN}"}}}')
    expect(await mcp.test('cases')).toMatchObject({ ok: false, error: '还没填凭据：CASE_TOKEN' })
  })

  it('reports a server that exits with what it printed', async () => {
    const { mcp } = service()
    mcp.add(
      JSON.stringify({
        bad: {
          command: process.execPath,
          args: ['-e', 'console.error("no token"); process.exit(1)'],
        },
      }),
    )
    const result = await mcp.test('bad')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('no token')
  }, 20_000)
})
