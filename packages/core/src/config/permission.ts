import { z } from 'zod'

// 权限：每个工具一档（允许 / 询问 / 拒绝），bash 这类按输入分档的工具可以写成“模式 → 档位”。
// 键是内核里的工具名，MCP 工具是 `<服务名>_<工具名>`；模式里 `*` 是通配，后写的优先。
// 三层叠加见 phase1-implementation 3.6 节：默认值 → 会话模式 → Agent 覆盖。

export const permissionLevelSchema = z.enum(['allow', 'ask', 'deny'])
export type PermissionLevel = z.infer<typeof permissionLevelSchema>

export const permissionValueSchema = z.union([
  permissionLevelSchema,
  z.record(z.string(), permissionLevelSchema),
])
export type PermissionValue = z.infer<typeof permissionValueSchema>

export const permissionSetSchema = z.record(z.string(), permissionValueSchema)
export type PermissionSet = z.infer<typeof permissionSetSchema>

// 输入框上的三档：执行前确认 / 只读 / 全部自动
export const permissionModeSchema = z.enum(['ask', 'read', 'auto'])
export type PermissionMode = z.infer<typeof permissionModeSchema>

// 只读命令白名单：这些写法的 bash 不用确认。只列确认过只读的调用形式：
// git branch 只放行列出分支的几种写法（-D、-m 会改分支），其他命令带任意参数
const READONLY_WITH_ARGS = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'pwd',
  'grep',
  'rg',
  'find',
  'tree',
  'echo',
]
export const readonlyCommandPatterns: string[] = [
  ...READONLY_WITH_ARGS.flatMap((cmd) => [cmd, `${cmd} *`]),
  'git branch',
  'git branch --list*',
  'git branch -a',
  'git branch -r',
  'git branch -v',
  'git branch -vv',
  'git branch --show-current',
]

// 白名单命令也能写文件或执行别的程序，这些写法回到 bash 的兜底档位（排在白名单后面，后写的优先）：
// 重定向、命令替换、git 的 --output 和外部 diff、find 的执行和写文件选项、rg 的预处理程序、tree 的输出文件
const unsafeCommandPatterns = [
  '*>*',
  '*$(*',
  '*`*',
  'git *--output*',
  'git *--ext-diff*',
  'find *-exec*',
  'find *-execdir*',
  'find *-delete*',
  'find *-ok*',
  'find *-fprint*',
  'find *-fls*',
  'rg *--pre*',
  'tree *-o *',
]

// MCP 工具名像写入操作的，默认询问
const WRITE_TOOL = /^(create|update|delete|push|send)_/
const WRITE_PREFIXES = ['create_', 'update_', 'delete_', 'push_', 'send_']

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOL.test(tool)
}

// 和内核一样的通配：`*` 匹配任意字符（含空），其余按字面
export function matchPattern(pattern: string, input: string): boolean {
  const re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${re}$`, 's').test(input)
}

// 一个工具对某个输入的最终档位：按模式顺序找最后一条匹配的
export function levelFor(
  value: PermissionValue | undefined,
  input: string,
): PermissionLevel | undefined {
  if (value === undefined || typeof value === 'string') return value
  let level: PermissionLevel | undefined
  for (const [pattern, l] of Object.entries(value)) if (matchPattern(pattern, input)) level = l
  return level
}

// 整个权限集对某个工具、某个输入的最终档位：工具名的键也可以带通配（`*`、`wiki_*`），按顺序后匹配的优先
export function effectiveLevel(
  set: PermissionSet,
  tool: string,
  input: string,
): PermissionLevel | undefined {
  let level: PermissionLevel | undefined
  for (const [key, value] of Object.entries(set)) {
    if (!matchPattern(key, tool)) continue
    level = levelFor(value, input) ?? level
  }
  return level
}

export function mcpToolKey(server: string, tool: string): string {
  return `${server}_${tool}`
}

// kits 自己的 MCP 服务名，ask_user / submit_output / remember 永远允许
export const KITS_MCP_SERVER = 'kits'

function bashRules(fallback: PermissionLevel): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': fallback }
  if (fallback === 'allow') return rules
  for (const pattern of readonlyCommandPatterns) rules[pattern] = 'allow'
  for (const pattern of unsafeCommandPatterns) rules[pattern] = fallback
  return rules
}

// phase1 方案 4.5 节的默认值，bash 带只读白名单
export const defaultPermissions: PermissionSet = {
  read: 'allow',
  grep: 'allow',
  glob: 'allow',
  list: 'allow',
  edit: 'allow',
  bash: bashRules('ask'),
  external_directory: 'ask',
  skill: 'allow',
  todowrite: 'allow',
  task: 'allow',
  lsp: 'allow',
  webfetch: 'deny',
  websearch: 'deny',
  doom_loop: 'ask',
  question: 'deny',
}

export interface ResolvePermissionsInput {
  mode: PermissionMode
  defaults?: PermissionSet
  // Agent 文件里的 permissions
  agent?: PermissionSet
  mcp?: {
    // 启用的 MCP 服务名（不含 kits）
    servers: string[]
    // mcp.json 的 permissions，键是 `<服务名>.<工具名>`
    rules: Record<string, PermissionLevel>
  }
}

function set(target: PermissionSet, key: string, value: PermissionValue): void {
  // 重新插入到末尾：内核按顺序匹配，后写的优先
  delete target[key]
  target[key] = value
}

function setPattern(target: PermissionSet, key: string, pattern: string, level: PermissionLevel) {
  const current = target[key]
  const rules: Record<string, PermissionLevel> =
    current === undefined ? {} : typeof current === 'string' ? { '*': current } : { ...current }
  delete rules[pattern]
  rules[pattern] = level
  set(target, key, rules)
}

export function resolvePermissions(input: ResolvePermissionsInput): PermissionSet {
  const { mode } = input
  const result: PermissionSet = structuredClone(input.defaults ?? defaultPermissions)

  // MCP：写入类按名字猜成询问，用户在设置页改过的照用户的
  const writeKeys = new Set<string>()
  for (const server of input.mcp?.servers ?? []) {
    for (const prefix of WRITE_PREFIXES) {
      const key = mcpToolKey(server, `${prefix}*`)
      writeKeys.add(key)
      set(result, key, 'ask')
    }
  }
  for (const [name, level] of Object.entries(input.mcp?.rules ?? {})) {
    const dot = name.indexOf('.')
    if (dot <= 0) continue
    const tool = name.slice(dot + 1)
    const key = mcpToolKey(name.slice(0, dot), tool)
    if (isWriteTool(tool) || level === 'ask') writeKeys.add(key)
    set(result, key, level)
  }
  set(result, mcpToolKey(KITS_MCP_SERVER, '*'), 'allow')

  // 会话模式
  if (mode === 'read') {
    set(result, 'edit', 'deny')
    set(result, 'bash', bashRules('deny'))
    set(result, 'external_directory', 'deny')
    for (const key of writeKeys) set(result, key, 'deny')
  } else if (mode === 'auto') {
    set(result, 'edit', 'allow')
    set(result, 'bash', bashRules('allow'))
    set(result, 'external_directory', 'ask')
  }

  // Agent 覆盖：deny 永远生效；allow / ask 只在“执行前确认”模式下生效
  for (const [key, value] of Object.entries(input.agent ?? {})) {
    if (typeof value === 'string') {
      if (value === 'deny' || mode === 'ask') set(result, key, value)
      continue
    }
    for (const [pattern, level] of Object.entries(value)) {
      if (level === 'deny' || mode === 'ask') setPattern(result, key, pattern, level)
    }
  }
  return result
}
