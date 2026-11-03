import { z } from 'zod'
import { permissionRuleSchema } from './permission'

// Agent 配置：提示词、模型、工具、技能、MCP、可选的输出格式。
// 存成 Markdown（frontmatter + 正文提示词），这里是解析后的形状。

export const agentProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  prompt: z.string().default(''),
  // 形如 `provider/model`，为空时用默认模型
  model: z.string().optional(),
  // 关闭的内置工具名；默认全部开启
  disabledTools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcp: z.array(z.string()).default([]),
  permissions: z.array(permissionRuleSchema).default([]),
  // JSON Schema；设置了才提供 submit_output 工具
  outputSchema: z.record(z.string(), z.unknown()).optional(),
})
export type AgentProfile = z.infer<typeof agentProfileSchema>

export const builtinAssistant: AgentProfile = agentProfileSchema.parse({
  name: 'assistant',
  description: '不限定任务的通用 Agent',
})
