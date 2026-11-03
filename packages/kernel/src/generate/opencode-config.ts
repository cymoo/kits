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
  type Settings,
  type SkillInfo,
} from '@kits/core'
import type { GeneratedFiles } from '../kernel'

// 统一配置 → opencode.json（phase1-implementation 4.1 节）。纯函数：输入全部配置和本次运行的参数，
// 输出要写的文件和要传给子进程的环境变量。密钥只进环境变量，配置文件里写 `{env:…}`，不落盘。
// 字段名对 1.19.5 的 GET /doc 核对过，契约测试（opencode-config.contract.test.ts）启动真实内核验证。

export interface OpencodeConfigInput {
  settings: Settings
  // 已按三级来源合并
  agents: AgentProfile[]
  mcp: McpFile
  // 已按三级来源合并、只含启用的
  skills: SkillInfo[]
  // 存在的 memory.md 绝对路径：个人在前、项目在后
  instructions: string[]
  // 网关 id → API Key（来自 secrets）
  gatewayKeys: Record<string, string>
  // MCP 配置里的 `${VAR}`：先查 secrets 再查环境变量
  lookupVar(name: string): string | undefined
  // kits 工具服务（ask_user / submit_output / remember）；不传就不挂
  kitsTools?: { url: string; token: string }
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

// 内核里的 agent 名加前缀，避免和 OpenCode 自带的 build / plan / general 等撞名
export function opencodeAgentName(name: string): string {
  return `kits-${name}`
}

function envName(prefix: string, id: string, suffix = ''): string {
  return `${prefix}${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}${suffix}`
}

export function gatewayKeyEnv(id: string): string {
  return envName('KITS_GW_', id, '_KEY')
}

// 一个 Agent 在某个会话模式下的完整权限：一串有顺序的规则（后面的优先），建会话时整串交给内核（PR2）。
// 层次：默认值和 MCP（按模式调整）→ Agent 覆盖（按文件顺序）→ 工具允许列表 → 技能允许列表 → kits 工具。
// 允许列表不是用户的权限选择，所以不受“allow 只在 ask 模式生效”的限制。
// 内核的 tools 开关不会转成权限规则（契约测试实测），列表外的工具在权限里也写 deny。
export function agentPermissions(
  agent: AgentProfile | undefined,
  mode: PermissionMode,
  mcp: McpFile,
): PermissionRule[] {
  const before = rulesBeforeSkills(agent, mode, mcp)
  return [...before, ...skillRules(agent, before), ...kitsToolRules]
}

function rulesBeforeSkills(
  agent: AgentProfile | undefined,
  mode: PermissionMode,
  mcp: McpFile,
): PermissionRule[] {
  return [
    ...flattenPermissions(basePermissions({ mode, mcp: mcpRules(mcp) })),
    ...(agent ? agentOverrideRules(agent.permissions, mode) : []),
    ...deniedBuiltinKeys(agent).map((tool) => ({ tool, pattern: '*', level: 'deny' as const })),
  ]
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
    const key = input.gatewayKeys[gw.id]
    if (!key) problems.push({ section: 'model', target: gw.id, message: '没有填 API Key' })
    else env[keyEnv] = key
    if (gw.models.length === 0) {
      problems.push({ section: 'model', target: gw.id, message: '没有可用的模型' })
    }
    provider[gw.id] = {
      npm: '@ai-sdk/openai-compatible',
      name: gw.name || gw.id,
      options: { baseURL: gw.baseUrl, apiKey: `{env:${keyEnv}}` },
      models: Object.fromEntries(
        gw.models.map((m) => [m.id, { name: m.id, tool_call: m.toolCall }]),
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
    const tools = agentTools(a, input.mcp)
    agent[opencodeAgentName(a.name)] = {
      mode: 'primary',
      ...(a.description ? { description: a.description } : {}),
      // 空提示词就用内核自带的系统提示词
      ...(a.prompt ? { prompt: a.prompt } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      permission: agentConfigPermission(a, input.mcp),
    }
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
    permission: {
      ...basePermissions({ mode: 'ask', mcp: mcpRules(input.mcp) }),
      ...Object.fromEntries(kitsToolRules.map((r) => [r.tool, r.level])),
    },
    mcp,
    // 技能目录直接列给内核，内核会把每个技能同时注册成 / 命令
    skills: { paths: input.skills.map((s) => s.dir) },
    instructions: input.instructions,
  }
  return {
    ok: true,
    config,
    files: {
      files: [{ path: 'opencode.json', content: `${JSON.stringify(config, null, 2)}\n` }],
      env,
    },
  }
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
