import { z } from 'zod'

// 每个工具一条规则：允许 / 询问 / 拒绝。转换到内核配置里的 permission 字段。
export const permissionLevelSchema = z.enum(['allow', 'ask', 'deny'])
export type PermissionLevel = z.infer<typeof permissionLevelSchema>

export const permissionRuleSchema = z.object({
  // 工具名，MCP 工具写成 `<服务名>.<工具名>`
  tool: z.string().min(1),
  level: permissionLevelSchema,
})
export type PermissionRule = z.infer<typeof permissionRuleSchema>

// phase1 方案 4.5 节的默认权限
export const defaultPermissionRules: PermissionRule[] = [
  { tool: 'read', level: 'allow' },
  { tool: 'grep', level: 'allow' },
  { tool: 'glob', level: 'allow' },
  { tool: 'edit', level: 'allow' },
  { tool: 'bash', level: 'ask' },
  { tool: 'external_directory', level: 'ask' },
  { tool: 'skill', level: 'allow' },
  { tool: 'todowrite', level: 'allow' },
  { tool: 'task', level: 'allow' },
  { tool: 'lsp', level: 'allow' },
  { tool: 'webfetch', level: 'deny' },
  { tool: 'websearch', level: 'deny' },
  { tool: 'doom_loop', level: 'ask' },
  { tool: 'question', level: 'deny' },
]
