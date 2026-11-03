import type { PermissionLevel } from './config/permission'

// 设置页 #agent 看到和编辑的 Agent（phase1-implementation PR14）

export type AgentSource = 'builtin' | 'personal' | 'project'

// 设置页能逐个设的内置工具（原型 settings.html#agent 的“工具与权限”）
export const AGENT_PERMISSION_TOOLS = [
  'read',
  'edit',
  'bash',
  'external_directory',
  'webfetch',
  'task',
] as const
export type AgentPermissionTool = (typeof AGENT_PERMISSION_TOOLS)[number]

// 能在设置页编辑的字段，对应 agents/<name>.md 的 frontmatter 和正文
export interface AgentDraft {
  name: string
  description: string
  // `<网关 id>/<模型 id>`，空 = 默认模型
  model?: string
  // 内置工具允许列表，空 = 全部
  tools?: string[]
  // 对默认权限的覆盖；设置页只改 AGENT_PERMISSION_TOOLS 里的整键，别的键原样保留
  permissions: Record<string, unknown>
  // 空 = 全部已启用的
  skills?: string[]
  mcp?: string[]
  // JSON Schema 文件，相对 Agent 文件
  output?: string
  prompt: string
}

export interface AgentView extends AgentDraft {
  source: AgentSource
  // 文件的绝对路径；代码里兜底的内置 assistant 没有
  path?: string
  // output 指向的文件读成功了
  hasOutputSchema: boolean
  // 被它覆盖的同名 Agent 来源
  shadows: AgentSource[]
  // 默认权限（ask 模式）下这几个工具是什么档位，设置页没覆盖时显示它
  defaults: Record<AgentPermissionTool, PermissionLevel>
}

export interface AgentOverview {
  agents: AgentView[]
  // 个人目录；项目目录只在给了工作目录时有
  dirs: Partial<Record<AgentSource, string>>
  // 读不了的 Agent 文件
  errors: { path: string; message: string }[]
}

export interface AgentSaveInput {
  // 存到哪：内置的不能改，复制一份存成个人或项目的
  source: 'personal' | 'project'
  workdir?: string
  // 改名时的旧名字；新建时不给
  original?: string
  draft: AgentDraft
}

export interface AgentRef {
  name: string
  source: AgentSource
  workdir?: string
}
