import { existsSync, readFileSync } from 'node:fs'
import {
  expandVars,
  isWriteTool,
  type McpServerConfig,
  type PermissionLevel,
  parseMcpFile,
  parseMcpPaste,
  serverVars,
  toMcpServersEntry,
} from '@kits/core'
import type { McpOverview, McpServerView, McpTestResult } from '@kits/core/ipc'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { writeFileAtomic } from '../config/atomic'

// 设置页 #mcp 的后端（phase1-implementation PR12）：读写 ~/.kits/mcp.json，测试连接并列出工具。
// mcp.json 保持 `mcpServers` 可粘贴的写法，kits 自己的 enabled / permissions 放在旁边；文件里别的字段原样保留。
// 测试连接直接用 MCP SDK 连服务（不经过内核）：内核没起来、没配模型时也能测，还能拿到工具列表给每个工具设权限。

export interface McpServiceDeps {
  file: string
  // 查 `${VAR}`：先 secrets（env:<VAR>）再环境变量，和生成内核配置时一样
  lookupVar(name: string): string | undefined
  hasVar(name: string): boolean
  // mcp.json 改了：内核要按新配置重启
  onChanged(): void
  now?: () => number
}

const TEST_TIMEOUT_MS = 15_000

type RawFile = {
  mcpServers?: Record<string, unknown>
  enabled?: Record<string, boolean>
  permissions?: Record<string, PermissionLevel>
  [key: string]: unknown
}

function describe(server: McpServerConfig): string {
  return server.type === 'http' ? server.url : [server.command, ...server.args].join(' ')
}

export class McpService {
  // 最近一次测试连接列出的工具：设置页展开服务时显示，重新测试才更新
  private tools = new Map<string, { name: string; description: string }[]>()
  private readonly now: () => number

  constructor(private readonly deps: McpServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  private readRaw(): RawFile {
    if (!existsSync(this.deps.file)) return {}
    return JSON.parse(readFileSync(this.deps.file, 'utf8')) as RawFile
  }

  // 改之前先读最新的文件：人可能手改过；文件坏了就不写，免得把人写的内容盖掉
  private update(change: (raw: RawFile) => void): void {
    let raw: RawFile
    try {
      raw = this.readRaw()
      parseMcpFile(raw)
    } catch (e) {
      throw new Error(
        `${this.deps.file} 读不了（${e instanceof Error ? e.message : String(e)}），先手动修好再在这里改`,
      )
    }
    change(raw)
    writeFileAtomic(this.deps.file, `${JSON.stringify(raw, null, 2)}\n`)
    this.deps.onChanged()
  }

  overview(): McpOverview {
    let file: ReturnType<typeof parseMcpFile>
    try {
      file = parseMcpFile(this.readRaw())
    } catch (e) {
      return {
        servers: [],
        error: `${this.deps.file} 读不了：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    const servers: McpServerView[] = Object.entries(file.servers).map(([name, server]) => {
      const rules = Object.fromEntries(
        Object.entries(file.permissions)
          .filter(([key]) => key.startsWith(`${name}.`))
          .map(([key, level]) => [key.slice(name.length + 1), level]),
      )
      return {
        name,
        type: server.type,
        enabled: server.enabled,
        address: describe(server),
        vars: serverVars(server).map((v) => ({ name: v, set: this.deps.hasVar(v) })),
        permissions: rules,
        tools: (this.tools.get(name) ?? []).map((t) => ({
          ...t,
          // 没单独设过的：写入类（create_、update_…）默认询问，其他允许
          level: rules[t.name] ?? (isWriteTool(t.name) ? 'ask' : 'allow'),
        })),
      }
    })
    return { servers }
  }

  // 粘贴识别：设置页一边打一边显示识别到哪些服务
  parse(text: string) {
    const r = parseMcpPaste(text)
    if (!r.ok) return r
    const existing = (() => {
      try {
        return parseMcpFile(this.readRaw()).servers
      } catch {
        return {}
      }
    })()
    return {
      ok: true as const,
      servers: Object.entries(r.servers).map(([name, s]) => ({
        name,
        type: s.type,
        vars: serverVars(s),
        exists: name in existing,
      })),
    }
  }

  add(text: string): string[] {
    const r = parseMcpPaste(text)
    if (!r.ok) throw new Error(r.error)
    this.update((raw) => {
      raw.mcpServers = { ...(raw.mcpServers ?? {}) }
      for (const [name, server] of Object.entries(r.servers)) {
        raw.mcpServers[name] = toMcpServersEntry(server)
        if (!server.enabled) raw.enabled = { ...(raw.enabled ?? {}), [name]: false }
        else if (raw.enabled) delete raw.enabled[name]
      }
    })
    return Object.keys(r.servers)
  }

  remove(name: string): void {
    this.update((raw) => {
      if (raw.mcpServers) delete raw.mcpServers[name]
      if (raw.enabled) delete raw.enabled[name]
      if (raw.permissions) {
        for (const key of Object.keys(raw.permissions)) {
          if (key.startsWith(`${name}.`)) delete raw.permissions[key]
        }
      }
    })
    this.tools.delete(name)
  }

  setEnabled(name: string, enabled: boolean): void {
    this.update((raw) => {
      raw.enabled = { ...(raw.enabled ?? {}) }
      if (enabled) delete raw.enabled[name]
      else raw.enabled[name] = false
    })
  }

  // level 为 null：回到默认（按工具名猜）
  setPermission(server: string, tool: string, level: PermissionLevel | null): void {
    this.update((raw) => {
      raw.permissions = { ...(raw.permissions ?? {}) }
      const key = `${server}.${tool}`
      if (level === null) delete raw.permissions[key]
      else raw.permissions[key] = level
    })
  }

  async test(name: string): Promise<McpTestResult> {
    const started = this.now()
    const elapsed = () => this.now() - started
    let server: McpServerConfig | undefined
    try {
      server = parseMcpFile(this.readRaw()).servers[name]
    } catch (e) {
      return { ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e) }
    }
    if (!server) return { ok: false, latencyMs: 0, error: `没有这个服务：${name}` }
    const missing = serverVars(server).filter((v) => this.deps.lookupVar(v) === undefined)
    if (missing.length) {
      return { ok: false, latencyMs: 0, error: `还没填凭据：${missing.join('、')}` }
    }
    const expand = (v: string) => expandVars(v, (n) => this.deps.lookupVar(n)).value
    const map = (r: Record<string, string>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, expand(v)]))
    const client = new Client({ name: 'kits', version: '0.1.0' })
    let stderr = ''
    const transport =
      server.type === 'http'
        ? new StreamableHTTPClientTransport(new URL(expand(server.url)), {
            requestInit: { headers: map(server.headers) },
          })
        : new StdioClientTransport({
            command: expand(server.command),
            args: server.args.map(expand),
            // PATH 这些要带上，npx 之类才找得到
            env: { ...(process.env as Record<string, string>), ...map(server.env) },
            ...(server.cwd ? { cwd: server.cwd } : {}),
            stderr: 'pipe',
          })
    if (transport instanceof StdioClientTransport) {
      transport.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_000)
      })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const listed = await Promise.race([
        (async () => {
          await client.connect(transport)
          return client.listTools()
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${TEST_TIMEOUT_MS / 1000} 秒内没有连上`)),
            TEST_TIMEOUT_MS,
          )
        }),
      ])
      const tools = listed.tools.map((t) => ({ name: t.name, description: t.description ?? '' }))
      this.tools.set(name, tools)
      return { ok: true, latencyMs: elapsed(), tools: tools.length }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        latencyMs: elapsed(),
        error: stderr.trim() ? `${reason}\n${stderr.trim()}` : reason,
      }
    } finally {
      clearTimeout(timer)
      await client.close().catch(() => {})
    }
  }
}
