import { z } from 'zod'

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
