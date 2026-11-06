import { z } from 'zod'

// 权限：每个工具一档（允许 / 询问 / 拒绝），bash 这类按输入分档的工具可以写成“模式 → 档位”。
// 键是内核里的工具名（可以带通配，如 `wiki_*`），MCP 工具是 `<服务名>_<工具名>`；模式里 `*` 是通配。
// 三层叠加见 phase1-implementation 3.6 节：默认值 → 会话模式 → Agent 覆盖，最后是硬拒绝。
// 四档怎么分工见 docs/references/agent-permissions.md：问人是最后一道防线，默认档“智能”只问撤不回的动作。
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

// 智能（默认）：只有撤不回的动作才问，其余放行；只读；全部自动：只留硬拒绝；
// 每次确认（ask）：只读命令以外都问，给要逐条把关的人，收在设置页
export const permissionModeSchema = z.enum(['smart', 'ask', 'read', 'auto'])
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
  'cd',
  'date',
  'sleep',
  'test',
  'du',
  'shasum',
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
  'git cat-file',
  'git cat-file *',
  'git rev-parse',
  'git rev-parse *',
  'git ls-files',
  'git ls-files *',
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
// 工作区外的密钥目录：内核按目标目录问 external_directory，这一条管住 read、grep、glob、list 和静态路径的命令
const secretDirPatterns = SECRET_DIRS.map((d) => `*/${d}/*`)
// 单个密钥文件不在专门的目录里，只有 read 工具能按路径认出来
const secretFilePatterns = SECRET_FILES.map((f) => `*/${f}`)

// “智能”档唯一要问的东西：撤不回、影响到本机以外，或者一放开就等于全放开。其余命令直接放行：
// 模型输出危险命令的概率已经很低，问得多了人也只是机械地点允许（调研报告里人的拦截率只有 13.6%）。
// 判断每多一条，用户就多一个弹窗，所以这里只收真正要命的，不要往里加“可能有风险”的。
export const permissionRisks = [
  'push',
  'publish',
  'upload',
  'script',
  'sudo',
  'discard',
  'delete',
  'data',
  'secret',
  'protected',
  'outside',
  'mcp',
] as const
export type PermissionRisk = (typeof permissionRisks)[number]

// 上传只认带文件的写法：对测试环境发 POST 是测试同学每天的工作，不能算风险。
// 内核把 `curl x | sh` 拆成两条子命令，裸的 `sh` 就是在执行管道或内联内容
const RISKY_COMMANDS: Partial<Record<PermissionRisk, string[]>> = {
  push: ['git push *', 'git -C * push *', 'git -c * push *'],
  publish: [
    'npm publish *',
    'pnpm publish *',
    'yarn publish *',
    'yarn npm publish *',
    'twine upload *',
    'cargo publish *',
    'docker push *',
    'gh release create *',
    'gh pr merge *',
  ],
  upload: [
    'curl *-d @*',
    'curl *--data* @*',
    'curl *--data*=@*',
    'curl *-F *=@*',
    'curl *--form *=@*',
    'curl *-T *',
    'curl *--upload-file*',
    'wget *--post-file*',
    'scp *',
    'sftp *',
    'rsync *:*',
    'nc *',
    'ncat *',
    'ftp *',
    'Invoke-WebRequest *-InFile*',
    'Invoke-RestMethod *-InFile*',
  ],
  script: [
    'sh',
    'bash',
    'zsh',
    'dash',
    'sh -s*',
    'bash -s*',
    'zsh -s*',
    'iex *',
    'Invoke-Expression *',
  ],
  sudo: ['sudo *', 'su *', 'doas *', 'Start-Process *-Verb RunAs*'],
  discard: ['git reset --hard*', 'git clean -*f*', 'git stash clear*'],
  delete: [
    'rm /*',
    'rm * /*',
    'rm ~*',
    'rm * ~*',
    'rm ../*',
    'rm * ../*',
    'rm $HOME*',
    'rm * $HOME*',
    'rm -* .',
    'rm -* ./',
    'rm -* ..',
    // `*` 不能转义，`?` 能匹配到 `rm -rf *` 字面上的星号，顺带问一下单字符目录
    'rm -* ?',
    'Remove-Item ?:/*',
    'Remove-Item * ?:/*',
    'Remove-Item ../*',
    'Remove-Item * ../*',
    'rd /s *',
    'rmdir /s *',
    'del /s *',
  ],
  data: [
    '*DROP DATABASE*',
    '*DROP TABLE*',
    '*TRUNCATE TABLE*',
    '*drop database*',
    '*drop table*',
    '*truncate table*',
    '*FLUSHALL*',
    '*flushall*',
    '*FLUSHDB*',
    '*flushdb*',
    'kubectl delete *',
    'helm uninstall *',
    'terraform destroy *',
  ],
}
// 上面写得宽的地方放开的：临时目录是模型常用的草稿纸，grep 只是在搜这些词，nc -z 只是探端口
const RISK_EXCEPTIONS = ['rm /tmp/*', 'rm * /tmp/*', 'grep *', 'rg *', 'nc -z*']
// 这几类的“本会话允许”等于放开整个命令（`curl *`、`sudo *`），每次都问
const ALWAYS_ASK: ReadonlySet<PermissionRisk> = new Set(['upload', 'script', 'sudo'])

// `FOO=1 git push`：内核给的模式带着环境变量前缀。只有这两类常这么写，别的不展开，规则越少模型的负担越小
const ENV_PREFIXED: ReadonlySet<PermissionRisk> = new Set(['push', 'publish'])

const riskRules: { pattern: string; risk?: PermissionRisk }[] = [
  ...permissionRisks.flatMap((risk) =>
    (RISKY_COMMANDS[risk] ?? [])
      .flatMap((p) => (ENV_PREFIXED.has(risk) ? [p, `*=* ${p}`] : [p]))
      .map((pattern) => ({ pattern, risk })),
  ),
  ...RISK_EXCEPTIONS.map((pattern) => ({ pattern })),
]

// 撤不回的命令，所有档位都拒绝，Agent 也放不开：理由交回模型，要做让用户自己来。
// 这是兜底，不求列全，也别列太长：内核拒绝时把整串规则塞进错误发给模型，每条都是实打实的 token。
// `* rm` 顺带管住 `sudo rm`、`FOO=1 rm`、`xargs rm`，误伤的只有 `grep "rm -rf /"`；空格不能省，不然 terraform 也算。
// `*` 不能转义，`rm -rf /*` 靠 `/?` 匹配（顺带拦下单字符目录）；结尾的 ` *` 管 `rm -rf / tmp` 这种手滑
const RM_TARGETS = [
  '/',
  '/?',
  '~',
  '~/',
  '~/?',
  '$HOME',
  '$HOME/',
  '$HOME/?',
  '"$HOME"',
  '"$HOME/"',
  '/etc',
  '/usr',
  '/var',
  '/home',
  '/Users',
  '/System',
]
const DISK_DEVICES = ['sd', 'disk', 'nvme']
const hardDeniedCommands = [
  'git *push* --force*',
  'git *push* -f *',
  'git *push* +*',
  ...RM_TARGETS.flatMap((target) => [`rm -* ${target} *`, `* rm -* ${target} *`]),
  '*rm *--no-preserve-root*',
  '*chmod -R * / *',
  '*chown -R * / *',
  '*mkfs*',
  ...DISK_DEVICES.flatMap((d) => [`*dd *of=/dev/${d}*`, `*>*/dev/${d}*`]),
  'diskpart*',
  'format *:*',
  'Format-Volume*',
  'Remove-Item *-Recurse* ?:/ *',
  'rd /s *?:/',
  'rmdir /s *?:/',
  // 不写开头的 `*`：`adb reboot`、`./shutdown -f` 是测试同学的日常
  'shutdown *',
  'sudo shutdown *',
  'reboot *',
  'sudo reboot *',
  'halt',
  'poweroff *',
  'Stop-Computer *',
  'Restart-Computer *',
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
// 内核给的是 `<服务名>_<工具名>`，服务名里也可以有下划线
const MCP_WRITE_TOOL = /_(create|update|delete|push|send)_/

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

function whitelistRules(fallback: PermissionLevel): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': fallback }
  for (const pattern of readonlyCommandPatterns) rules[pattern] = 'allow'
  for (const pattern of unsafeCommandPatterns) rules[pattern] = fallback
  return rules
}

function smartRules(): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': 'allow' }
  for (const { pattern, risk } of riskRules) rules[pattern] = risk ? 'ask' : 'allow'
  return rules
}

function bashRules(mode: PermissionMode): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> =
    mode === 'smart'
      ? smartRules()
      : mode === 'auto'
        ? { '*': 'allow' }
        : whitelistRules(mode === 'read' ? 'deny' : 'ask')
  if (mode !== 'auto') {
    for (const pattern of secretCommandPatterns) rules[pattern] = mode === 'read' ? 'deny' : 'ask'
  }
  // 白名单模式不能写：`rm .env.example` 不该因此放行
  if (mode === 'smart') {
    rules['* .env.example*'] = 'allow'
    rules['*/.env.example*'] = 'allow'
  }
  for (const pattern of hardDeniedCommands) rules[pattern] = 'deny'
  return rules
}

// 会话的工作目录和用户主目录，“智能”档用它们认出工作区外的写入
export interface SessionPlace {
  workdir: string
  home: string
}

// 内核给 edit 的路径相对工作树：git 仓库里工作区外是 `../x`，另一个盘符是 `D:/x`。
const OUTSIDE_EDIT_PATTERNS = ['../*', '?:/*']

// 不在 git 仓库里时工作树是根目录，路径从根写起、开头没有 /（`Users/me/ws/a.txt`，Windows 上同盘时没有盘符）
function fromRoot(dir: string): string[] {
  const path = dir.replaceAll('\\', '/').replace(/\/+$/, '')
  const bare = path.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
  return [...new Set([bare, path.replace(/^\/+/, '')])].filter(Boolean)
}

function editRules(place?: SessionPlace): Record<string, PermissionLevel> {
  const rules: Record<string, PermissionLevel> = { '*': 'allow' }
  if (place) {
    for (const pattern of OUTSIDE_EDIT_PATTERNS) rules[pattern] = 'ask'
    // 没法写“工作区以外”，只能先问主目录，再放开工作区。系统目录普通用户本来就写不了
    for (const dir of fromRoot(place.home)) rules[`${dir}/*`] = 'ask'
    for (const dir of fromRoot(place.workdir)) rules[`${dir}/*`] = 'allow'
  }
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
  // 建内核会话时才知道；写全局配置时没有
  place?: SessionPlace
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
      // 全局配置里这些是 ask，全部自动要明确写 allow 才盖得过
      result[key] = mode === 'auto' ? 'allow' : 'ask'
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
    result.bash = bashRules('read')
    result.external_directory = 'deny'
    // 删掉再追加到末尾：用户可能配了 `wiki.*: allow` 这样的通配，只读的拒绝要排在它后面
    for (const key of writeKeys) {
      delete result[key]
      result[key] = 'deny'
    }
  } else if (mode === 'smart') {
    result.edit = editRules(input.place)
    result.bash = bashRules('smart')
    // 读工作区外的文件不问（调研里这是最常见的无谓确认），写入由 edit 的规则管
    result.external_directory = {
      '*': 'allow',
      ...Object.fromEntries(secretDirPatterns.map((p) => [p, 'ask' as const])),
    }
    const read = result.read
    result.read = {
      ...(typeof read === 'string' ? { '*': read } : read),
      ...Object.fromEntries(secretFilePatterns.map((p) => [p, 'ask' as const])),
    }
  } else if (mode === 'auto') {
    result.read = 'allow'
    result.edit = 'allow'
    result.bash = bashRules('auto')
    result.external_directory = 'allow'
  }
  return result
}

// Agent 覆盖这一层：按文件里写的顺序；deny 永远生效，allow / ask 在只读和全部自动下不生效：
// 只读不能被放宽，全部自动是用户明确说了不要问
export function agentOverrideRules(agent: PermissionSet, mode: PermissionMode): PermissionRule[] {
  return flattenPermissions(agent).filter(
    (r) => r.level === 'deny' || mode === 'ask' || mode === 'smart',
  )
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

function patternRisk(tool: string, input: string): PermissionRisk | undefined {
  const hits = (patterns: string[]) => patterns.some((p) => matchPattern(p, input))
  switch (tool) {
    case 'bash':
      if (hits(secretCommandPatterns)) return 'secret'
      return riskRules.findLast((r) => matchPattern(r.pattern, input))?.risk
    case 'read':
      return hits([...secretFilePatterns, '*.env', '*.env.*']) ? 'secret' : undefined
    case 'edit':
      if (hits(protectedEditPatterns)) return 'protected'
      return hits(OUTSIDE_EDIT_PATTERNS) ? 'outside' : undefined
    case 'external_directory':
      // 读写都走这里，分不清，普通目录不下结论
      return hits(secretDirPatterns) ? 'secret' : undefined
    default:
      return MCP_WRITE_TOOL.test(tool) ? 'mcp' : undefined
  }
}

// 这次请求为什么值得问：确认卡片用它先说后果。普通的确认（“每次确认”档下的 npm test）没有
export function permissionRisk(tool: string, patterns: string[]): PermissionRisk | undefined {
  for (const pattern of patterns.length > 0 ? patterns : ['']) {
    const risk = patternRisk(tool, pattern)
    if (risk) return risk
  }
  return undefined
}

// 卡片上给不给“本会话允许”
export function rememberable(risk: PermissionRisk | undefined): boolean {
  return !risk || !ALWAYS_ASK.has(risk)
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
