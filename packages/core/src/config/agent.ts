import { z } from 'zod'
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { permissionSetSchema } from './permission'

// Agent 配置存成 Markdown：frontmatter 写模型、工具、权限、技能、MCP、输出格式，正文是提示词。
// 来源三级：内置 → 个人（~/.kits/agents）→ 项目（<工作目录>/.agents/agents），同名的后者优先。

export const configSourceSchema = z.enum(['builtin', 'personal', 'project'])
export type ConfigSource = z.infer<typeof configSourceSchema>

// 文件名、内核里的 agent 名都由它派生
export const configNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
  message: '只能用字母、数字、- 和 _，且不能以符号开头',
})

// 列表字段可以写成 YAML 数组，也可以写成逗号分隔的一行（原型里 `tools: read, grep, glob`）；
// `all` 或省略表示不限制
const listField = z.preprocess((v) => {
  if (v === 'all' || v === null) return undefined
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return v
}, z.array(z.string()).optional())

export const agentFrontmatterSchema = z.object({
  name: configNameSchema,
  description: z.string().default(''),
  // `<网关 id>/<模型 id>`，省略用默认模型
  model: z.string().optional(),
  // 内置工具的允许列表，省略 = 全部
  tools: listField,
  // 对默认权限的覆盖
  permissions: permissionSetSchema.default({}),
  // 省略 = 全部已启用的技能 / MCP 服务
  skills: listField,
  mcp: listField,
  // JSON Schema 文件，相对 Agent 文件；设置了才提供 submit_output
  output: z.string().optional(),
})

export const agentProfileSchema = agentFrontmatterSchema.extend({
  prompt: z.string().default(''),
  source: configSourceSchema.default('personal'),
  // 来源文件的绝对路径；内置的也有
  path: z.string().optional(),
  // 从 output 指向的文件读进来
  outputSchema: z.record(z.string(), z.unknown()).optional(),
})
export type AgentProfile = z.infer<typeof agentProfileSchema>

export interface ParseAgentOptions {
  source: ConfigSource
  path?: string
  // frontmatter 没写 name 时用文件名
  fallbackName?: string
}

export function parseAgentMarkdown(text: string, options: ParseAgentOptions): AgentProfile {
  const { data, body } = parseFrontmatter(text)
  const front = agentFrontmatterSchema.parse({ name: options.fallbackName, ...data })
  return agentProfileSchema.parse({
    ...front,
    prompt: body.trim(),
    source: options.source,
    ...(options.path ? { path: options.path } : {}),
  })
}

export function serializeAgentMarkdown(profile: AgentProfile): string {
  return stringifyFrontmatter(
    {
      name: profile.name,
      description: profile.description || undefined,
      model: profile.model,
      tools: profile.tools,
      permissions: Object.keys(profile.permissions).length > 0 ? profile.permissions : undefined,
      skills: profile.skills,
      mcp: profile.mcp,
      output: profile.output,
    },
    `${profile.prompt.trim()}\n`,
  )
}

export const builtinAssistant: AgentProfile = agentProfileSchema.parse({
  name: 'assistant',
  description: '不限定任务的通用 Agent',
  source: 'builtin',
})

// 三级来源按优先级合并：后面的同名项覆盖前面的，被覆盖的来源记在 shadows 里，界面标“同名，项目的优先”
export function mergeBySource<T extends { name: string; source: ConfigSource }>(
  ...lists: T[][]
): (T & { shadows: ConfigSource[] })[] {
  const byName = new Map<string, T & { shadows: ConfigSource[] }>()
  for (const list of lists) {
    for (const item of list) {
      const prev = byName.get(item.name)
      const shadows = prev ? [...prev.shadows, prev.source] : []
      byName.delete(item.name)
      byName.set(item.name, { ...item, shadows })
    }
  }
  return [...byName.values()]
}
