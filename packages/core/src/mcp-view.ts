import type { PermissionLevel } from './config/permission'

// 设置页 #mcp 看到的服务（phase1-implementation PR12）

export interface McpToolView {
  name: string
  description: string
  // 现在生效的权限：设置过的照设置，没设过的写入类询问、其他允许
  level: PermissionLevel
}

export interface McpServerView {
  name: string
  type: 'stdio' | 'http'
  enabled: boolean
  // http 是地址，stdio 是命令行
  address: string
  // 配置里的 `${VAR}`，以及有没有填（secrets 或环境变量里有）
  vars: { name: string; set: boolean }[]
  // mcp.json 里单独设过的工具权限，键是工具名
  permissions: Record<string, PermissionLevel>
  // 最近一次测试连接列出的工具；还没测过是空的
  tools: McpToolView[]
}

export interface McpOverview {
  servers: McpServerView[]
  // mcp.json 读不了
  error?: string
}

export type McpTestResult =
  | { ok: true; latencyMs: number; tools: number }
  | { ok: false; latencyMs: number; error: string }

export type McpParseResult =
  | {
      ok: true
      servers: { name: string; type: 'stdio' | 'http'; vars: string[]; exists: boolean }[]
    }
  | { ok: false; error: string }
