import {
  type AgentProfile,
  agentOverrideRules,
  basePermissions,
  checkJsonSchema,
  effectiveLevel,
  expandVars,
  findModel,
  findVars,
  flattenPermissions,
  KITS_MCP_SERVER,
  kitsToolRules,
  type McpFile,
  type McpServerConfig,
  type PermissionLevel,
  type PermissionMode,
  type PermissionRule,
  type PermissionSet,
  type SessionPlace,
  type Settings,
  type SkillInfo,
} from '@kits/core'
import type { GeneratedFiles } from '../kernel'
import { DESCRIBE_BASH_PLUGIN, DESCRIBE_BASH_PLUGIN_PATH } from './describe-bash-plugin'

// 统一配置 → opencode.json（phase1-implementation 4.1 节）。纯函数：输入全部配置和本次运行的参数，
// 输出要写的文件和要传给子进程的环境变量。密钥只进环境变量，配置文件里写 `{env:…}`，不落盘。
// 字段名对 1.19.5 的 GET /doc 核对过，契约测试（opencode-config.contract.test.ts）启动真实内核验证。

export interface OpencodeConfigInput {
  settings: Settings
  // 已按三级来源合并
  agents: AgentProfile[]
  mcp: McpFile
  // 内置和个人技能里启用的，目录列给内核；项目技能（<工作目录>/.agents/skills）由内核自己按会话目录找
  skills: SkillInfo[]
  // 关掉的技能名（含项目技能）：内核里拒绝调用
  disabledSkills?: string[]
  // 存在的 memory.md 绝对路径：个人在前、项目在后
  instructions: string[]
  // 网关 id → API Key（来自 secrets）
  gatewayKeys: Record<string, string>
  // MCP 配置里的 `${VAR}`：先查 secrets 再查环境变量
  lookupVar(name: string): string | undefined
  // kits 工具服务（ask_user / submit_output / remember）；不传就不挂。timeoutMs 默认 24 小时，测试用
  kitsTools?: { url: string; token: string; timeoutMs?: number }
}

export interface ConfigProblem {
  // 指向设置页的分区：model / mcp / agent
  section: 'model' | 'mcp' | 'agent'
  // 出问题的条目：网关 id、MCP 服务名、Agent 名
  target: string
  message: string
}

export type GenerateResult =
  | { ok: true; files: GeneratedFiles; config: Record<string, unknown> }
  | { ok: false; problems: ConfigProblem[] }

const VAR_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

// OpenCode 1.19.5 的内置工具（GET /experimental/tool/ids，去掉 invalid 和 question）
export const OPENCODE_BUILTIN_TOOLS = [
  'bash',
  'read',
  'glob',
  'grep',
  'edit',
  'write',
  'apply_patch',
  'task',
  'webfetch',
  'todowrite',
  'websearch',
  'skill',
] as const

// kits 的工具名到内核工具名：Agent 文件里写 edit 就包括新建和打补丁
const TOOL_ALIASES: Record<string, string[]> = {
  edit: ['edit', 'write', 'apply_patch'],
}

// 内置工具对应的权限键：write 和 apply_patch 归 edit 管
const TOOL_PERMISSION: Record<string, string> = { write: 'edit', apply_patch: 'edit' }

function allowedBuiltinTools(agent: AgentProfile): Set<string> | undefined {
  return agent.tools ? new Set(agent.tools.flatMap((t) => TOOL_ALIASES[t] ?? [t])) : undefined
}

export const KITS_TOOLS_TOKEN_ENV = 'KITS_TOOLS_TOKEN'

// 不需要鉴权的网关写进配置的 key：openai-compatible 要求有值，内容随意
export const NO_KEY = 'kits-no-key'

// 1.19.5 默认 60 s 掐断 MCP 工具调用（契约测试实测），阻塞的 ask_user 要等人回答，放宽到 24 小时
export const KITS_TOOLS_TIMEOUT_MS = 24 * 60 * 60 * 1000

// 内核里的 agent 名加前缀，避免和 OpenCode 自带的 build / plan / general 等撞名
export function opencodeAgentName(name: string): string {
  return `kits-${name}`
}

// 项目 Agent（<工作目录>/.agents/agents）用的内核 agent：没有自己的工具开关和模型，
// 权限随会话（提示词和所有 Agent 一样随消息的 system 带上）。名字以 _ 开头，和用户的 Agent 名（不能以符号开头）不会撞
export const PROJECT_BASE_AGENT = '_project'

// 内核里实际用哪个 agent：项目 Agent 用公共的底座
export function kernelAgentOf(agent: Pick<AgentProfile, 'name' | 'source'>): string {
  return agent.source === 'project' ? PROJECT_BASE_AGENT : agent.name
}

// 每条消息随 system 带上的提示词：正文 + 输出格式说明，接在内核自带的系统提示词后面
export function agentSystemPrompt(agent: AgentProfile): string {
  return [agent.prompt, agent.outputSchema ? outputSection(agent.outputSchema) : '']
    .filter(Boolean)
    .join('\n\n')
}

// 内核按 limit 判断什么时候自动压缩：没写就是 0，永远不压缩，上下文满了直接报错。
// 上下文减掉 output 是可用的部分，小窗口的模型 output 不能占满整个窗口
const MAX_OUTPUT_TOKENS = 32_000
function modelLimit(context: number): { context: number; output: number } {
  return { context, output: Math.min(MAX_OUTPUT_TOKENS, Math.floor(context / 4)) }
}

function envName(prefix: string, id: string, suffix = ''): string {
  return `${prefix}${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}${suffix}`
}

export function gatewayKeyEnv(id: string): string {
  return envName('KITS_GW_', id, '_KEY')
}

// 一个 Agent 在某个会话模式下的完整权限：一串有顺序的规则（后面的优先），建会话时整串交给内核（PR2）。
// 层次：默认值和 MCP（按模式调整）→ Agent 覆盖（按文件顺序）→ 工具允许列表 → 技能允许列表 → kits 工具。
// 允许列表不是用户的权限选择，所以不受“allow 在只读和全部自动下不生效”的限制。
// 内核的 tools 开关不会转成权限规则（契约测试实测），列表外的工具在权限里也写 deny。
export function agentPermissions(
  agent: AgentProfile | undefined,
  mode: PermissionMode,
  mcp: McpFile,
  place?: SessionPlace,
): PermissionRule[] {
  const before = rulesBeforeSkills(agent, mode, mcp, place)
  return [...before, ...skillRules(agent, before), ...kitsToolRules]
}

function rulesBeforeSkills(
  agent: AgentProfile | undefined,
  mode: PermissionMode,
  mcp: McpFile,
  place?: SessionPlace,
): PermissionRule[] {
  return [
    ...flattenPermissions(
      basePermissions({ mode, mcp: mcpRules(mcp), ...(place ? { place } : {}) }),
    ),
    ...(agent ? agentOverrideRules(agent.permissions, mode) : []),
    ...deniedBuiltinKeys(agent).map((tool) => ({ tool, pattern: '*', level: 'deny' as const })),
    ...deniedServers(agent, mcp).map((server) => ({
      tool: `${server}_*`,
      pattern: '*',
      level: 'deny' as const,
    })),
  ]
}

// Agent 的 mcp 允许列表之外的服务：内核的 tools 开关只是不给模型看，权限里也拒绝
function deniedServers(agent: AgentProfile | undefined, mcp: McpFile): string[] {
  if (!agent?.mcp) return []
  const allowed = new Set(agent.mcp)
  return enabledServers(mcp).filter((s) => !allowed.has(s))
}

function mcpRules(mcp: McpFile) {
  return { servers: enabledServers(mcp), rules: mcp.permissions }
}

function deniedBuiltinKeys(agent: AgentProfile | undefined): string[] {
  const allowed = agent && allowedBuiltinTools(agent)
  if (!allowed) return []
  const keys = new Set(OPENCODE_BUILTIN_TOOLS.map((t) => TOOL_PERMISSION[t] ?? t))
  for (const t of allowed) keys.delete(TOOL_PERMISSION[t] ?? t)
  return [...keys]
}

// 技能允许列表和前面算出来的 skill 权限取交集：列表外的拒绝，列表内的保留原来的档位（deny、ask 照旧，
// 包括 Agent 写的 `'*': deny` 这类通配）
function skillRules(agent: AgentProfile | undefined, before: PermissionRule[]): PermissionRule[] {
  if (!agent?.skills) return []
  return [
    { tool: 'skill', pattern: '*', level: 'deny' },
    ...agent.skills.map((name) => ({
      tool: 'skill',
      pattern: name,
      level: effectiveLevel(before, 'skill', name) ?? ('allow' as const),
    })),
  ]
}

// 写进 opencode.json 的 Agent 权限：内核把它接在全局权限后面。Agent 自己写的规则原样保留顺序，
// 允许列表、技能和 kits 工具都是整键替换，不改动其他键的顺序
function agentConfigPermission(agent: AgentProfile, mcp: McpFile): PermissionSet {
  const result: PermissionSet = structuredClone(agent.permissions)
  const replace = (key: string, value: PermissionSet[string]) => {
    delete result[key]
    result[key] = value
  }
  for (const key of deniedBuiltinKeys(agent)) replace(key, 'deny')
  const skills = skillRules(agent, rulesBeforeSkills(agent, 'ask', mcp))
  if (skills.length > 0)
    replace('skill', Object.fromEntries(skills.map((r) => [r.pattern, r.level])))
  for (const r of kitsToolRules) replace(r.tool, r.level)
  return result
}

// 规则串 → OpenCode 建会话时的 permission 数组（顺序不变，后面的优先）
export function toOpencodeRuleset(
  rules: PermissionRule[],
): { permission: string; pattern: string; action: PermissionLevel }[] {
  return rules.map((r) => ({ permission: r.tool, pattern: r.pattern, action: r.level }))
}

function enabledServers(mcp: McpFile): string[] {
  return Object.entries(mcp.servers)
    .filter(([name, s]) => s.enabled && name !== KITS_MCP_SERVER)
    .map(([name]) => name)
}

function agentTools(agent: AgentProfile, mcp: McpFile): Record<string, boolean> {
  const tools: Record<string, boolean> = {}
  const allowed = allowedBuiltinTools(agent)
  if (allowed) {
    for (const t of OPENCODE_BUILTIN_TOOLS) if (!allowed.has(t)) tools[t] = false
  }
  if (agent.skills && agent.skills.length === 0) tools.skill = false
  if (agent.mcp) {
    const allowed = new Set(agent.mcp)
    for (const server of enabledServers(mcp)) {
      if (!allowed.has(server)) tools[`${server}_*`] = false
    }
  }
  if (!agent.outputSchema) tools[`${KITS_MCP_SERVER}_submit_output`] = false
  return tools
}

// 一个内置或个人 Agent 在 opencode.json 里的样子（设置页“看转换结果”也用）。
// 不写 prompt：OpenCode 的 agent prompt 会顶掉内核自带的系统提示词（里面有怎么用工具），
// Agent 的提示词改成每条消息随 system 带上（agentSystemPrompt），接在内核的后面，三级来源一样
export function opencodeAgentEntry(a: AgentProfile, mcp: McpFile): Record<string, unknown> {
  const tools = agentTools(a, mcp)
  return {
    mode: 'primary',
    ...(a.description ? { description: a.description } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    permission: agentConfigPermission(a, mcp),
  }
}

// kits 工具服务所有会话共用一份工具列表，submit_output 的描述里放不下各 Agent 的格式，所以写进 Agent 提示词
export function outputSection(schema: Record<string, unknown>): string {
  return [
    '## 输出格式',
    '',
    `完成后调用 \`${KITS_MCP_SERVER}_submit_output\` 工具提交结果，\`output\` 必须符合下面的 JSON Schema；不符合会返回错误，按错误修正后重新提交。`,
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n')
}

export function generateOpencodeConfig(input: OpencodeConfigInput): GenerateResult {
  const problems: ConfigProblem[] = []
  const env: Record<string, string> = {}
  const { settings } = input

  // 网关 → provider
  const provider: Record<string, unknown> = {}
  const envOwners = new Map<string, string>()
  const gateways = settings.gateways.filter((g) => g.enabled)
  if (gateways.length === 0) {
    problems.push({ section: 'model', target: 'gateways', message: '还没有启用的模型网关' })
  }
  for (const gw of gateways) {
    const keyEnv = gatewayKeyEnv(gw.id)
    const owner = envOwners.get(keyEnv)
    if (owner) {
      problems.push({
        section: 'model',
        target: gw.id,
        message: `网关 id 和 ${owner} 只差 - 和 _，换一个 id`,
      })
    }
    envOwners.set(keyEnv, gw.id)
    if (!gw.baseUrl) problems.push({ section: 'model', target: gw.id, message: '网关地址为空' })
    // 不需要鉴权的网关（内网自建的 vLLM 之类）可以不填 key，配置里写一个占位值
    const key = input.gatewayKeys[gw.id]
    if (key) env[keyEnv] = key
    if (gw.models.length === 0) {
      problems.push({ section: 'model', target: gw.id, message: '没有可用的模型' })
    }
    provider[gw.id] = {
      npm: '@ai-sdk/openai-compatible',
      name: gw.name || gw.id,
      options: { baseURL: gw.baseUrl, apiKey: key ? `{env:${keyEnv}}` : NO_KEY },
      models: Object.fromEntries(
        gw.models.map((m) => [
          m.id,
          { name: m.id, tool_call: m.toolCall, limit: modelLimit(m.contextWindow) },
        ]),
      ),
    }
  }

  if (!settings.defaultModel) {
    problems.push({ section: 'model', target: 'defaultModel', message: '还没有选默认模型' })
  } else if (!findModel(settings.gateways, settings.defaultModel)) {
    problems.push({
      section: 'model',
      target: 'defaultModel',
      message: `默认模型 ${settings.defaultModel} 不在任何启用的网关里`,
    })
  }

  // MCP：`${VAR}` 换成 `{env:KITS_MCP_VAR}`，值进子进程环境变量
  const mcp: Record<string, unknown> = {}
  // 变量名转成环境变量名时会转大写，${TOKEN} 和 ${token} 会撞到同一个 KITS_MCP_TOKEN
  const varOwners = new Map<string, string>()
  const toEnvRef = (server: string, value: string): string => {
    // 停用的服务不连接，只做占位符转换，不查变量、不参与撞名检查
    if (!input.mcp.servers[server]?.enabled)
      return value.replace(VAR_REF, (_, n: string) => `{env:${envName('KITS_MCP_', n)}}`)
    for (const name of findVars(value)) {
      const target = envName('KITS_MCP_', name)
      const owner = varOwners.get(target)
      if (owner !== undefined && owner !== name) {
        problems.push({
          section: 'mcp',
          target: server,
          message: `变量 ${name} 和 ${owner} 只差大小写或符号，换一个名字`,
        })
        continue
      }
      varOwners.set(target, name)
      const { value: resolved, missing } = expandVars(`\${${name}}`, input.lookupVar)
      if (missing.length > 0) {
        problems.push({ section: 'mcp', target: server, message: `找不到变量 ${name}` })
      } else {
        env[envName('KITS_MCP_', name)] = resolved
      }
    }
    return value.replace(VAR_REF, (_, n: string) => `{env:${envName('KITS_MCP_', n)}}`)
  }
  const mapValues = (server: string, record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, toEnvRef(server, v)]))
  for (const [name, server] of Object.entries(input.mcp.servers)) {
    // 内核里的工具名是 `<服务名>_<工具名>`，kits_ 开头的服务名会和 kits 自己的工具混在一起
    if (name === KITS_MCP_SERVER || name.startsWith(`${KITS_MCP_SERVER}_`)) {
      problems.push({
        section: 'mcp',
        target: name,
        message: 'kits 和 kits_ 开头的服务名是保留的，换一个名字',
      })
      continue
    }
    mcp[name] = opencodeMcp(server, name, mapValues, toEnvRef)
  }
  if (input.kitsTools) {
    env[KITS_TOOLS_TOKEN_ENV] = input.kitsTools.token
    mcp[KITS_MCP_SERVER] = {
      type: 'remote',
      url: input.kitsTools.url,
      headers: { Authorization: `Bearer {env:${KITS_TOOLS_TOKEN_ENV}}` },
      enabled: true,
      oauth: false,
      timeout: input.kitsTools.timeoutMs ?? KITS_TOOLS_TIMEOUT_MS,
    }
  }

  // Agent
  const agent: Record<string, unknown> = {}
  for (const a of input.agents) {
    if (a.model && !findModel(settings.gateways, a.model)) {
      problems.push({
        section: 'agent',
        target: a.name,
        message: `模型 ${a.model} 不在任何启用的网关里`,
      })
    }
    if (a.outputSchema) {
      const schemaProblems = checkJsonSchema(a.outputSchema)
      if (schemaProblems.length > 0) {
        problems.push({
          section: 'agent',
          target: a.name,
          message: `输出格式不是合法的 JSON Schema：${schemaProblems.join('；')}`,
        })
      }
    }
    agent[opencodeAgentName(a.name)] = opencodeAgentEntry(a, input.mcp)
  }

  // 项目 Agent 的底座：内核自带的系统提示词，权限用全局的，会话再按 Agent 收紧
  agent[opencodeAgentName(PROJECT_BASE_AGENT)] = {
    mode: 'primary',
    description: '项目 Agent（提示词随消息带上）',
  }

  if (problems.length > 0) return { ok: false, problems }

  const defaultAgent =
    input.agents.find((a) => a.name === 'assistant')?.name ?? input.agents[0]?.name
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    // 内网环境：不检查更新、不分享、不自动下载 LSP、不跑格式化（格式化会改 Agent 没碰过的行）
    autoupdate: false,
    share: 'disabled',
    lsp: false,
    formatter: false,
    enabled_providers: gateways.map((g) => g.id),
    provider,
    model: settings.defaultModel,
    ...(defaultAgent ? { default_agent: opencodeAgentName(defaultAgent) } : {}),
    agent,
    permission: withSkillDenies(
      {
        ...basePermissions({ mode: 'ask', mcp: mcpRules(input.mcp) }),
        ...Object.fromEntries(kitsToolRules.map((r) => [r.tool, r.level])),
      },
      input.disabledSkills ?? [],
    ),
    mcp,
    // 技能目录直接列给内核，内核会把每个技能同时注册成 / 命令
    skills: { paths: input.skills.map((s) => s.dir) },
    instructions: input.instructions,
  }
  return {
    ok: true,
    config,
    files: {
      files: [
        { path: 'opencode.json', content: `${JSON.stringify(config, null, 2)}\n` },
        { path: DESCRIBE_BASH_PLUGIN_PATH, content: DESCRIBE_BASH_PLUGIN },
      ],
      env,
    },
  }
}

// OpenCode 自带的技能：教人改 opencode.json 的，kits 用户用不上，也不该让 Agent 去改内核配置
export const KERNEL_BUILTIN_SKILLS = ['customize-opencode']

// 关掉的技能、内核自带的技能一律拒绝。会话的规则排在全局后面（最后命中的生效），建会话时也要追加一遍
export function skillDenies(disabled: string[]): PermissionRule[] {
  return [...new Set([...KERNEL_BUILTIN_SKILLS, ...disabled])].map((name) => ({
    tool: 'skill',
    pattern: name,
    level: 'deny' as const,
  }))
}

function withSkillDenies(
  permission: Record<string, unknown>,
  disabled: string[],
): Record<string, unknown> {
  const base = permission.skill
  const rules: Record<string, unknown> =
    typeof base === 'object' && base !== null ? { ...(base as object) } : { '*': base ?? 'allow' }
  for (const r of skillDenies(disabled)) rules[r.pattern] = r.level
  return { ...permission, skill: rules }
}

function opencodeMcp(
  server: McpServerConfig,
  name: string,
  mapValues: (server: string, r: Record<string, string>) => Record<string, string>,
  toEnvRef: (server: string, v: string) => string,
): Record<string, unknown> {
  if (server.type === 'stdio') {
    return {
      type: 'local',
      command: [server.command, ...server.args].map((v) => toEnvRef(name, v)),
      environment: mapValues(name, server.env),
      ...(server.cwd ? { cwd: server.cwd } : {}),
      enabled: server.enabled,
    }
  }
  return {
    type: 'remote',
    url: toEnvRef(name, server.url),
    headers: mapValues(name, server.headers),
    enabled: server.enabled,
    // 内网服务用固定 token，不走 OAuth 自动发现
    oauth: false,
  }
}
