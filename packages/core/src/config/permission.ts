import { z } from 'zod'

// 权限：每个工具一档（允许 / 询问 / 拒绝），bash 这类按输入分档的工具可以写成“模式 → 档位”。
// 键是内核里的工具名（可以带通配，如 `wiki_*`），MCP 工具是 `<服务名>_<工具名>`；模式里 `*` 是通配。
// 三层叠加见 phase1-implementation 3.6 节：默认值 → 会话模式 → Agent 覆盖，最后是硬拒绝。
// 解析结果是一串有顺序的规则（和内核一样，后面匹配的优先）：每一层整段接在前一层后面，不挪动、不合并，
// 所以 Agent 里后写的规则一定压过前面的默认值和 MCP 设置，通配键之间怎么相交都不用特殊处理。

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
// Windows 上模型常用的只读命令：cmd 的内置命令和 PowerShell cmdlet。内核按大小写精确匹配，这里写规范写法。
// 不收别名：gc、sls 这些短名字在别的平台是别的程序
const READONLY_WINDOWS = [
  'dir',
  'type',
  'findstr',
  'Get-ChildItem',
  'Get-Content',
  'Get-Item',
  'Get-Location',
  'Test-Path',
  'Resolve-Path',
  'Select-String',
  'Select-Object',
  'Where-Object',
  'Sort-Object',
  'Measure-Object',
]
export const readonlyCommandPatterns: string[] = [
  ...[...READONLY_WITH_ARGS, ...READONLY_WINDOWS].flatMap((cmd) => [cmd, `${cmd} *`]),
  'git branch',
  'git branch --list*',
  'git branch -a',
  'git branch -r',
  'git branch -v',
  'git branch -vv',
  'git branch --show-current',
]

// 白名单命令也能写文件或执行别的程序，这些写法回到 bash 的兜底档位（排在白名单后面，后写的优先）：
// 重定向、命令替换、git 的 --output 和外部 diff、find 的执行和写文件选项、rg 的预处理程序、tree 的输出文件、
// PowerShell 管道命令的脚本块（块里的 .NET 调用不算命令，内核拆不出来）
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
  'Select-Object *{*',
  'Where-Object *{*',
  'Sort-Object *{*',
]

// 密钥文件：白名单命令也能读它们，内核只检查固定命令表里的静态路径，`cat $HOME/.ssh/x` 这类写法它不问。
// 按命令文本匹配，只挡写出路径的，防的是模型顺手读，不是有意绕过。
// 按目录写而不是具体文件：内核的 PowerShell 解析会截掉路径最后一段，`.docker/config.json` 到这里只剩 `.docker`
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker']
const SECRET_FILES = ['.netrc', '.git-credentials', '.npmrc', '.pypirc']
const secretCommandPatterns = [
  ...SECRET_DIRS.flatMap((d) => [`*${d} *`, `*${d}/*`]),
  ...SECRET_FILES.map((f) => `*${f}*`),
  '* .env *',
  '* .env.*',
  '*/.env *',
  '*/.env.*',
]

// 撤不回的命令，所有档位都拒绝，Agent 也放不开：理由交回模型，要做让用户自己来。
// 这是兜底，不求列全，`*` 不能转义，所以 `rm -rf /*` 这种写不出来（写了会连带拦掉所有绝对路径）
const RM_RF = ['-rf', '-fr', '-Rf', '-fR', '-r -f', '-f -r']
const hardDeniedCommands = [
  'git *push* --force*',
  'git *push* -f *',
  ...RM_RF.flatMap((flags) => ['/', '~', '~/', '$HOME', '$HOME/'].map((t) => `rm ${flags} ${t}`)),
  'mkfs*',
  'dd *of=/dev/sd*',
  'dd *of=/dev/disk*',
  'dd *of=/dev/nvme*',
  'diskpart*',
  'format *:*',
  'Format-Volume*',
  'Remove-Item -Recurse -Force C:\\',
]

// 工作区里改了等于改权限或执行命令的路径：.git（core.fsmonitor、diff.external、hooks 让白名单里的
// git status 跑任意命令）、内核和 kits 的项目配置、CI、编辑器任务、git 钩子工具。“执行前确认”下要问
const PROTECTED_DIRS = ['.git', '.opencode', '.agents', '.github/workflows', '.husky', '.vscode']
const PROTECTED_FILES = ['.git', 'opencode.json', 'opencode.jsonc', '.env', '.env.*']
const protectedEditPatterns = [
  ...PROTECTED_DIRS.flatMap((d) => [`${d}/*`, `*/${d}/*`]),
  ...PROTECTED_FILES.flatMap((f) => [f, `*/${f}`]),
]

// MCP 工具名像写入操作的，默认询问
const WRITE_TOOL = /^(create|update|delete|push|send)_/
const WRITE_PREFIXES = ['create_', 'update_', 'delete_', 'push_', 'send_']

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOL.test(tool)
}

// 和内核一样的通配：`*` 匹配任意字符（含空），`?` 匹配一个字符，结尾的 ` *` 可以没有，反斜杠当斜杠
export function matchPattern(pattern: string, input: string): boolean {
  const re = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/ \.\*$/, '( .*)?')
  return new RegExp(`^${re}$`, 's').test(input.replaceAll('\\', '/'))
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

// 一条规则：工具名（可带通配）+ 输入模式 + 档位
export interface PermissionRule {
  tool: string
  pattern: string
  level: PermissionLevel
}

export function flattenPermissions(set: PermissionSet): PermissionRule[] {
  return Object.entries(set).flatMap(([tool, value]) =>
    typeof value === 'string'
      ? [{ tool, pattern: '*', level: value }]
      : Object.entries(value).map(([pattern, level]) => ({ tool, pattern, level })),
  )
}

// 一串规则对某个工具、某个输入的最终档位：按顺序找最后一条工具名和输入都匹配的
export function effectiveLevel(
  rules: PermissionRule[],
  tool: string,
  input: string,
): PermissionLevel | undefined {
  let level: PermissionLevel | undefined
  for (const r of rules)
    if (matchPattern(r.tool, tool) && matchPattern(r.pattern, input)) level = r.level
  return level
}

export function mcpToolKey(server: string, tool: string): string {
  return `${server}_${tool}`
}

// kits 自己的 MCP 服务名，ask_user / submit_output / remember 永远允许。
// 按完整工具名放行而不是 `kits_*`：别的服务名如果以 kits_ 开头，它的工具不能跟着被放行（配置转换也会拒绝这种名字）
export const KITS_MCP_SERVER = 'kits'
export const KITS_TOOLS = ['ask_user', 'submit_output', 'remember'] as const

function bashRules(fallback: PermissionLevel): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': fallback }
  if (fallback !== 'allow') {
    for (const pattern of readonlyCommandPatterns) rules[pattern] = 'allow'
    for (const pattern of unsafeCommandPatterns) rules[pattern] = fallback
  }
  for (const pattern of secretCommandPatterns) rules[pattern] = fallback === 'deny' ? 'deny' : 'ask'
  for (const pattern of hardDeniedCommands) rules[pattern] = 'deny'
  return rules
}

function editRules(): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': 'allow' }
  for (const pattern of protectedEditPatterns) rules[pattern] = 'ask'
  return rules
}

// phase1 方案 4.5 节的默认值，bash 带只读白名单。
// 规则写在这里而不是只写在会话上：内核的子会话只继承 deny，ask 要靠这份全局规则才管得到子任务
export const defaultPermissions: PermissionSet = {
  // 会话规则排在内核默认值后面，这里不写内核的 .env 询问就被 allow 盖掉了
  read: { '*': 'allow', '*.env': 'ask', '*.env.*': 'ask', '*.env.example': 'allow' },
  grep: 'allow',
  glob: 'allow',
  list: 'allow',
  edit: editRules(),
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

// 第一层：默认值 + MCP 设置，按会话模式调整。只整键替换，不涉及顺序问题，结果还是 PermissionSet（写进内核配置的全局权限）
export function basePermissions(input: Omit<ResolvePermissionsInput, 'agent'>): PermissionSet {
  const { mode } = input
  const result: PermissionSet = structuredClone(input.defaults ?? defaultPermissions)

  // MCP：写入类按名字猜成询问，用户在设置页改过的照用户的（具体工具排在通配后面）
  const writeKeys = new Set<string>()
  for (const server of input.mcp?.servers ?? []) {
    for (const prefix of WRITE_PREFIXES) {
      const key = mcpToolKey(server, `${prefix}*`)
      writeKeys.add(key)
      result[key] = 'ask'
    }
  }
  for (const [name, level] of Object.entries(input.mcp?.rules ?? {})) {
    const dot = name.indexOf('.')
    if (dot <= 0) continue
    const tool = name.slice(dot + 1)
    const key = mcpToolKey(name.slice(0, dot), tool)
    if (isWriteTool(tool) || level === 'ask') writeKeys.add(key)
    delete result[key]
    result[key] = level
  }

  if (mode === 'read') {
    result.edit = 'deny'
    result.bash = bashRules('deny')
    result.external_directory = 'deny'
    // 删掉再追加到末尾：用户可能配了 `wiki.*: allow` 这样的通配，只读的拒绝要排在它后面
    for (const key of writeKeys) {
      delete result[key]
      result[key] = 'deny'
    }
  } else if (mode === 'auto') {
    result.edit = 'allow'
    result.bash = bashRules('allow')
    result.external_directory = 'ask'
  }
  return result
}

// Agent 覆盖这一层：按文件里写的顺序；deny 永远生效，allow / ask 只在“执行前确认”模式下生效
export function agentOverrideRules(agent: PermissionSet, mode: PermissionMode): PermissionRule[] {
  return flattenPermissions(agent).filter((r) => r.level === 'deny' || mode === 'ask')
}

// 硬拒绝排在 Agent 覆盖后面，Agent 写 `bash: allow` 也放不开
export const hardDenyRules: PermissionRule[] = hardDeniedCommands.map((pattern) => ({
  tool: 'bash',
  pattern,
  level: 'deny' as const,
}))

// 内核给的 `always` 是 `*` 时等于放行整个工具：edit 只有保护路径才问，点一次“本会话允许”
// 就把所有保护路径都开了。收窄到这次请求的内容，请求里没有具体内容时才保留
export function alwaysScope(patterns: string[], always: string[]): string[] {
  const concrete = patterns.filter((p) => p !== '*')
  return always.includes('*') && concrete.length > 0 ? concrete : always
}

// kits 自己的工具（提问、提交产出、记忆）放在最后，Agent 写了 `'*': deny` 也照样能用
export const kitsToolRules: PermissionRule[] = KITS_TOOLS.map((tool) => ({
  tool: mcpToolKey(KITS_MCP_SERVER, tool),
  pattern: '*',
  level: 'allow' as const,
}))

export function resolvePermissions(input: ResolvePermissionsInput): PermissionRule[] {
  return [
    ...flattenPermissions(basePermissions(input)),
    ...agentOverrideRules(input.agent ?? {}, input.mode),
    ...hardDenyRules,
    ...kitsToolRules,
  ]
}
