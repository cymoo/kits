import { findVars, type McpServerConfig, mcpServerSchema } from './mcp'

// 设置页“添加服务”的粘贴识别（phase1-implementation PR12）：Claude、Cursor 的 `mcpServers`，
// OpenCode 的 `mcp`（local / remote，command 是数组），还有直接粘一个 `{ "名字": {...} }`，都转成 kits 的写法。

export type PasteResult =
  | { ok: true; servers: Record<string, McpServerConfig> }
  | { ok: false; error: string }

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function fromOpencode(raw: Record<string, unknown>): unknown {
  if (raw.type === 'local') {
    const [command, ...args] = Array.isArray(raw.command) ? (raw.command as string[]) : []
    return {
      type: 'stdio',
      command,
      args,
      env: raw.environment ?? {},
      ...(raw.enabled === false ? { enabled: false } : {}),
    }
  }
  if (raw.type === 'remote') {
    return {
      type: 'http',
      url: raw.url,
      headers: raw.headers ?? {},
      ...(raw.enabled === false ? { enabled: false } : {}),
    }
  }
  return raw
}

function normalize(raw: unknown): unknown {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (obj.type === 'local' || obj.type === 'remote') return fromOpencode(obj)
  if (obj.type === 'streamable-http' || obj.type === 'sse') return { ...obj, type: 'http' }
  if ('type' in obj) return obj
  return 'url' in obj ? { ...obj, type: 'http' } : { ...obj, type: 'stdio' }
}

export function parseMcpPaste(text: string): PasteResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: '要粘贴一个对象，比如 { "mcpServers": { … } }' }
  }
  const root = json as Record<string, unknown>
  const map =
    (root.mcpServers as Record<string, unknown> | undefined) ??
    (root.mcp as Record<string, unknown> | undefined) ??
    root
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return { ok: false, error: 'mcpServers 应该是一个对象' }
  }
  const servers: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(map)) {
    if (!NAME.test(name)) return { ok: false, error: `服务名 ${name} 只能用字母、数字、- 和 _` }
    const parsed = mcpServerSchema.safeParse(normalize(raw))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        ok: false,
        error: `${name}：${issue?.path.join('.') || '配置'} ${issue?.message ?? '不对'}`,
      }
    }
    servers[name] = parsed.data
  }
  if (!Object.keys(servers).length) return { ok: false, error: '没有找到服务' }
  return { ok: true, servers }
}

// 服务配置里用到的 `${VAR}` 占位（地址、请求头、命令参数、环境变量），设置页据此列出要填的凭据
export function serverVars(server: McpServerConfig): string[] {
  const values =
    server.type === 'http'
      ? [server.url, ...Object.values(server.headers)]
      : [server.command, ...server.args, ...Object.values(server.env)]
  return [...new Set(values.flatMap(findVars))]
}

// 写回 mcp.json 的 `mcpServers` 条目：保持常见写法，可以复制给别的工具用；enabled 放在 kits 自己的字段里
export function toMcpServersEntry(server: McpServerConfig): Record<string, unknown> {
  if (server.type === 'http') {
    return {
      type: 'http',
      url: server.url,
      ...(Object.keys(server.headers).length ? { headers: server.headers } : {}),
    }
  }
  return {
    command: server.command,
    ...(server.args.length ? { args: server.args } : {}),
    ...(Object.keys(server.env).length ? { env: server.env } : {}),
    ...(server.cwd ? { cwd: server.cwd } : {}),
  }
}
