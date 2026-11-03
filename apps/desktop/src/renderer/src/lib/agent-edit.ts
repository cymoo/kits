import type { AgentDraft, PermissionLevel } from '@kits/core/ipc'

// 设置页 #agent 编辑草稿用的纯函数：工具档位、技能 / MCP 允许列表、新名字。

// 设置页的一个工具对应 Agent 文件 tools 允许列表里的哪几项（read 包括搜索）
const TOOL_MEMBERS: Record<string, string[]> = { read: ['read', 'grep', 'glob'] }

function levelOf(value: unknown): PermissionLevel | undefined {
  if (value === 'allow' || value === 'ask' || value === 'deny') return value
  if (value && typeof value === 'object') return levelOf((value as Record<string, unknown>)['*'])
  return undefined
}

// 这个工具在“执行前确认”模式下实际是哪一档：不在 tools 允许列表里就是禁止，其次看覆盖，最后看默认值
export function toolLevel(
  draft: AgentDraft,
  tool: string,
  defaults: Record<string, PermissionLevel>,
): PermissionLevel {
  if (draft.tools && !draft.tools.includes(tool)) return 'deny'
  return levelOf(draft.permissions[tool]) ?? defaults[tool] ?? 'ask'
}

// 设成某一档：和默认值一样就去掉覆盖（文件里少写一行）；从禁止改回来时补进 tools 允许列表
export function setToolLevel(
  draft: AgentDraft,
  tool: string,
  level: PermissionLevel,
  defaults: Record<string, PermissionLevel>,
): AgentDraft {
  const permissions = { ...draft.permissions }
  delete permissions[tool]
  if (level !== defaults[tool]) permissions[tool] = level
  let tools = draft.tools
  if (tools && level !== 'deny' && !tools.includes(tool)) {
    tools = [...tools, ...(TOOL_MEMBERS[tool] ?? [tool]).filter((t) => !tools?.includes(t))]
  }
  return { ...draft, permissions, ...(tools ? { tools } : {}) }
}

// 技能 / MCP 的允许列表：undefined = 全部。勾掉一项时从“全部”展开成具体的列表
export function toggleAllowed(
  list: string[] | undefined,
  all: string[],
  name: string,
): string[] | undefined {
  const current = list ?? all
  const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
  // 勾回全部了：写回“全部”，以后新加的技能 / 服务也能用
  return all.every((n) => next.includes(n)) && next.length === all.length ? undefined : next
}

export function isAllowed(list: string[] | undefined, name: string): boolean {
  return !list || list.includes(name)
}

// 新建、复制时的名字：撞了就加 -2、-3
export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}

// 两份草稿是不是一样（判断有没有没保存的改动）
export function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  const norm = (d: AgentDraft) =>
    JSON.stringify({
      ...d,
      model: d.model || undefined,
      output: d.output || undefined,
      prompt: d.prompt.trim(),
    })
  return norm(a) === norm(b)
}
