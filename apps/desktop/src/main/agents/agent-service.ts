import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  AGENT_PERMISSION_TOOLS,
  type AgentPermissionTool,
  type AgentProfile,
  agentFrontmatterSchema,
  defaultPermissions,
  findModel,
  loadAgentFile,
  type McpFile,
  type PermissionLevel,
  parseFrontmatter,
  stringifyFrontmatter,
} from '@kits/core'
import type {
  AgentDraft,
  AgentOverview,
  AgentRef,
  AgentSaveInput,
  AgentSource,
  AgentView,
} from '@kits/core/ipc'
import {
  agentPermissions,
  agentSystemPrompt,
  opencodeAgentEntry,
  opencodeAgentName,
  PROJECT_BASE_AGENT,
  toOpencodeRuleset,
} from '@kits/kernel'
import { writeFileAtomic } from '../config/atomic'
import type { ConfigService } from '../config/config-service'
import { listAgents } from '../kernel/kernel-config'

// 设置页 #agent 的后端（phase1-implementation PR14）：三级来源列出、保存成 Markdown、删除、看转换结果、
// 新建输出格式文件。内置的只读，复制一份存成个人或项目的。
// 个人的改了内核按新配置重启（内核配置里有它）；项目的不进内核配置，下一条消息起按新文件。

export interface AgentServiceDeps {
  config: ConfigService
  builtinDir?: string
  loadMcp(): McpFile
  // 个人 Agent 改了：内核要按新配置重启
  onChanged(): void
  // 删除时移到废纸篓
  trash(file: string): Promise<void>
  openPath(file: string): Promise<void>
}

// 新建输出格式时的起步内容：一条一条的发现，界面里按条审核
const STARTER_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '一句话说明' },
          detail: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  required: ['items'],
}

function levelOf(value: unknown): PermissionLevel | undefined {
  if (value === 'allow' || value === 'ask' || value === 'deny') return value
  // 按模式写的规则（bash 的白名单）：看通配那一条
  if (value && typeof value === 'object') return levelOf((value as Record<string, unknown>)['*'])
  return undefined
}

const DEFAULTS = Object.fromEntries(
  AGENT_PERMISSION_TOOLS.map((t) => [t, levelOf(defaultPermissions[t]) ?? 'ask']),
) as Record<AgentPermissionTool, PermissionLevel>

function draftOf(a: AgentProfile | AgentView): AgentDraft {
  return {
    name: a.name,
    description: a.description,
    ...(a.model ? { model: a.model } : {}),
    ...(a.tools ? { tools: a.tools } : {}),
    permissions: a.permissions,
    ...(a.skills ? { skills: a.skills } : {}),
    ...(a.mcp ? { mcp: a.mcp } : {}),
    ...(a.output ? { output: a.output } : {}),
    prompt: a.prompt,
  }
}

function viewOf(a: AgentProfile & { shadows?: AgentSource[] }): AgentView {
  return {
    ...draftOf(a),
    source: a.source,
    ...(a.path ? { path: a.path } : {}),
    hasOutputSchema: Boolean(a.outputSchema),
    shadows: a.shadows ?? [],
    defaults: DEFAULTS,
  }
}

export class AgentService {
  constructor(private readonly deps: AgentServiceDeps) {}

  private dirOf(source: AgentSource, workdir?: string): string {
    if (source === 'personal') return this.deps.config.paths.agents
    if (source === 'project') {
      if (!workdir) throw new Error('项目 Agent 要先选工作区')
      return path.join(realpathSync(workdir), '.agents', 'agents')
    }
    throw new Error('内置的 Agent 不能改，复制一份再改')
  }

  overview(workdir?: string): AgentOverview {
    const dir = workdir && existsSync(workdir) ? realpathSync(workdir) : undefined
    const { agents, errors } = listAgents(this.deps.config, this.deps.builtinDir, dir)
    return {
      agents: agents.map(viewOf),
      dirs: {
        personal: this.deps.config.paths.agents,
        ...(dir ? { project: path.join(dir, '.agents', 'agents') } : {}),
      },
      errors: errors.map((e) => ({ path: e.path, message: e.message })),
    }
  }

  private find(ref: AgentRef): AgentView {
    const found = this.overview(ref.workdir).agents.find(
      (a) => a.name === ref.name && a.source === ref.source,
    )
    if (!found) throw new Error(`找不到 Agent ${ref.name}`)
    return found
  }

  save(input: AgentSaveInput): AgentView {
    const { draft } = input
    const front = agentFrontmatterSchema.safeParse({ ...draft, permissions: draft.permissions })
    if (!front.success) {
      const issue = front.error.issues[0]
      throw new Error(issue?.path[0] === 'name' ? `名字${issue.message}` : (issue?.message ?? ''))
    }
    // 指定了不存在的模型，内核配置会生成失败：存之前就拦下
    if (draft.model && !findModel(this.deps.config.getSettings().gateways, draft.model)) {
      throw new Error(`模型 ${draft.model} 不在任何启用的网关里`)
    }
    const dir = this.dirOf(input.source, input.workdir)
    const file = path.join(dir, `${draft.name}.md`)
    const oldFile = input.original ? path.join(dir, `${input.original}.md`) : undefined
    if (existsSync(file) && file !== oldFile) throw new Error(`已经有一个叫 ${draft.name} 的 Agent`)

    // 文件里 kits 不认识的字段原样保留（人可能手写了别的工具用的配置）
    const previous = oldFile && existsSync(oldFile) ? readFileSync(oldFile, 'utf8') : undefined
    const extra = previous ? parseFrontmatter(previous).data : {}
    const permissions = Object.keys(draft.permissions).length ? draft.permissions : undefined
    const text = stringifyFrontmatter(
      {
        ...extra,
        name: draft.name,
        description: draft.description || undefined,
        model: draft.model || undefined,
        tools: draft.tools,
        permissions,
        skills: draft.skills,
        mcp: draft.mcp,
        output: draft.output || undefined,
      },
      `${draft.prompt.trim()}\n`,
    )
    writeFileAtomic(file, text)
    // 读回来校验（输出格式文件能不能读、是不是合法的 JSON Schema）；不行就恢复原样
    let saved: AgentProfile
    try {
      saved = loadAgentFile(file, input.source)
    } catch (e) {
      if (file === oldFile && previous !== undefined) writeFileAtomic(file, previous)
      else rmSync(file, { force: true })
      throw e
    }
    if (oldFile && oldFile !== file) rmSync(oldFile, { force: true })
    if (input.source === 'personal') this.deps.onChanged()
    return viewOf(saved)
  }

  async remove(ref: AgentRef): Promise<void> {
    const agent = this.find(ref)
    if (agent.source === 'builtin' || !agent.path) throw new Error('内置的 Agent 不能删')
    await this.deps.trash(agent.path)
    if (agent.source === 'personal') this.deps.onChanged()
  }

  // 转换结果（设置页“看转换结果”）。
  // 改的是已有的 Agent 时，输出格式按它的文件位置读进来
  preview(input: { source: AgentSource; workdir?: string; original?: string; draft: AgentDraft }) {
    const { source, draft } = input
    const mcp = this.deps.loadMcp()
    const file = input.original
      ? this.overview(input.workdir).agents.find(
          (a) => a.name === input.original && a.source === source,
        )?.path
      : undefined
    const profile: AgentProfile = {
      ...draft,
      permissions: draft.permissions as AgentProfile['permissions'],
      source,
      ...(draft.output && file ? { outputSchema: readSchema(file, draft.output) } : {}),
    }
    const system = agentSystemPrompt(profile)
    // 内置、个人的：opencode.json 里那一段 + 每条消息带的提示词；项目的：底座 + 提示词 + 会话权限
    const result =
      source === 'project'
        ? {
            agent: opencodeAgentName(PROJECT_BASE_AGENT),
            ...(draft.model ? { model: draft.model } : {}),
            permission: toOpencodeRuleset(agentPermissions(profile, 'ask', mcp)),
            ...(system ? { system } : {}),
          }
        : {
            'opencode.json': {
              agent: { [opencodeAgentName(draft.name)]: opencodeAgentEntry(profile, mcp) },
            },
            ...(system ? { system } : {}),
          }
    return JSON.stringify(result, null, 2)
  }

  createOutput(ref: AgentRef): AgentView {
    const agent = this.find(ref)
    if (agent.source === 'builtin' || !agent.path)
      throw new Error('内置的 Agent 不能改，复制一份再改')
    const name = `${agent.name}.schema.json`
    const file = path.join(path.dirname(agent.path), name)
    if (!existsSync(file)) writeFileAtomic(file, `${JSON.stringify(STARTER_SCHEMA, null, 2)}\n`)
    return this.save({
      source: agent.source,
      ...(ref.workdir ? { workdir: ref.workdir } : {}),
      original: agent.name,
      draft: { ...draftOf(agent), output: name },
    })
  }

  async open(ref: AgentRef & { what: 'file' | 'output' }): Promise<void> {
    const agent = this.find(ref)
    if (!agent.path) throw new Error('这个 Agent 没有文件')
    const file =
      ref.what === 'file'
        ? agent.path
        : agent.output
          ? path.resolve(path.dirname(agent.path), agent.output)
          : undefined
    if (!file) throw new Error('这个 Agent 没有输出格式文件')
    await this.deps.openPath(file)
  }
}

// 预览用：读不了就当没有输出格式（保存时会报错）
function readSchema(agentFile: string, output: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(
      readFileSync(path.resolve(path.dirname(agentFile), output), 'utf8'),
    )
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}
