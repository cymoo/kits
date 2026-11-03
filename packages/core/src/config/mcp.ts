import { z } from 'zod'
import { type PermissionLevel, permissionLevelSchema } from './permission'

// 用户配置的 MCP 服务，兼容常见的 `mcpServers` 写法，可以直接粘贴。

const stdioServerSchema = z.object({
  type: z.literal('stdio').default('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
  enabled: z.boolean().default(true),
})

const httpServerSchema = z.object({
  type: z.literal('http'),
  // 只支持 Streamable HTTP，file:、ftp: 等协议在这里就拦住
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
})

export const mcpServerSchema = z.discriminatedUnion('type', [stdioServerSchema, httpServerSchema])
export type McpServerConfig = z.infer<typeof mcpServerSchema>

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
})

// 常见写法里 stdio 服务不写 type，有 url 的是 http 服务；这里先补齐再校验。
export function parseMcpConfig(input: unknown): Record<string, McpServerConfig> {
  const { mcpServers } = mcpConfigSchema.parse(input)
  const result: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(mcpServers)) {
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const withType =
      'type' in obj ? obj : 'url' in obj ? { ...obj, type: 'http' } : { ...obj, type: 'stdio' }
    const normalized =
      withType.type === 'streamable-http' || withType.type === 'sse'
        ? { ...withType, type: 'http' }
        : withType
    result[name] = mcpServerSchema.parse(normalized)
  }
  return result
}

// ~/.kits/mcp.json：`mcpServers` 保持可粘贴，`enabled` 和 `permissions` 是 kits 自己的字段。
// permissions 的键写成 `<服务名>.<工具名>`，没写的工具按名字猜（见 permission.ts 的 isWriteTool）。
export const mcpFileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
  enabled: z.record(z.string(), z.boolean()).default({}),
  permissions: z.record(z.string(), permissionLevelSchema).default({}),
})

export interface McpFile {
  servers: Record<string, McpServerConfig>
  permissions: Record<string, PermissionLevel>
}

export function parseMcpFile(input: unknown): McpFile {
  const file = mcpFileSchema.parse(input ?? {})
  const servers = parseMcpConfig({ mcpServers: file.mcpServers })
  for (const [name, enabled] of Object.entries(file.enabled)) {
    const server = servers[name]
    if (server) server.enabled = enabled
  }
  return { servers, permissions: file.permissions }
}

// `${VAR}` 占位：先查 secrets 再查环境变量（查找顺序由调用方的 lookup 决定）
const VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export function findVars(value: string): string[] {
  return [...value.matchAll(VAR)].map((m) => m[1] ?? '')
}

export function expandVars(
  value: string,
  lookup: (name: string) => string | undefined,
): { value: string; missing: string[] } {
  const missing: string[] = []
  const expanded = value.replace(VAR, (_, name: string) => {
    const v = lookup(name)
    if (v === undefined) missing.push(name)
    return v ?? ''
  })
  return { value: expanded, missing }
}
