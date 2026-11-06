import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  builtinAssistant,
  gatewaySecretKey,
  loadAgentsDir,
  loadSkillsDir,
  mergeBySource,
  parseMcpFile,
  resolveSkills,
  type Settings,
} from '@kits/core'
import type { KernelName } from '@kits/core/ipc'
import { generateOpencodeConfig, type KernelConfig } from '@kits/kernel'
import type { ConfigService } from '../config/config-service'
import type { SecretStore } from '../config/secrets'

// 启动内核前把 ~/.kits 和密钥收拢成内核配置（phase1-implementation 4.1、5.1 节），写进 {userData}/kernel/<id>/config。
// 内核配置全局一份，只放内置和个人的 Agent、技能；项目的技能由内核按会话目录自己找，项目的 Agent 随消息带上。

export interface KernelDirs {
  config: string
  data: string
  logs: string
}

// 项目记忆相对工作目录的位置
export const PROJECT_MEMORY = '.agents/memory.md'

export function kernelDirs(userDataDir: string, id: KernelName): KernelDirs {
  const root = path.join(userDataDir, 'kernel', id)
  return {
    config: path.join(root, 'config'),
    data: path.join(root, 'data'),
    logs: path.join(root, 'logs'),
  }
}

export function logFileFor(dirs: KernelDirs, now = new Date()): string {
  return path.join(dirs.logs, `${now.toISOString().slice(0, 10)}.log`)
}

export interface PrepareInput {
  config: ConfigService
  secrets: SecretStore
  kitsTools?: { url: string; token: string }
  env?: NodeJS.ProcessEnv
  // 内置的技能、Agent 所在目录（resources/builtin）；测试里可以不给
  builtinDir?: string
}

// 三级技能：内置（resources/builtin/skills）、个人（~/.kits/skills）、项目（<工作目录>/.agents/skills），
// 同名时项目覆盖个人覆盖内置；settings.json 里关掉的标成停用
export function loadSkills(config: ConfigService, builtinDir?: string, workdir?: string) {
  const builtin = builtinDir
    ? loadSkillsDir(path.join(builtinDir, 'skills'), 'builtin')
    : { items: [], errors: [] }
  const personal = loadSkillsDir(config.paths.skills, 'personal')
  const project = workdir
    ? loadSkillsDir(path.join(workdir, '.agents', 'skills'), 'project')
    : { items: [], errors: [] }
  return {
    skills: resolveSkills(
      [builtin.items, personal.items, project.items],
      config.getSettings().skillsDisabled,
    ),
    errors: [...builtin.errors, ...personal.errors, ...project.errors],
  }
}

const none = { items: [], errors: [] }

// 三级 Agent：内置（resources/builtin/agents）、个人（~/.kits/agents）、项目（<工作目录>/.agents/agents），
// 同名时项目覆盖个人覆盖内置。资源目录里没有 assistant 时（单测）用代码里兜底的那个
export function listAgents(config: ConfigService, builtinDir?: string, workdir?: string) {
  const builtin = builtinDir ? loadAgentsDir(path.join(builtinDir, 'agents'), 'builtin') : none
  const builtins = builtin.items.some((a) => a.name === 'assistant')
    ? builtin.items
    : [builtinAssistant, ...builtin.items]
  const personal = loadAgentsDir(config.paths.agents, 'personal')
  const project = workdir ? loadAgentsDir(path.join(workdir, '.agents', 'agents'), 'project') : none
  return {
    agents: mergeBySource(builtins, personal.items, project.items),
    errors: [...builtin.errors, ...personal.errors, ...project.errors],
  }
}

export function loadAgents(config: ConfigService, builtinDir?: string, workdir?: string) {
  return listAgents(config, builtinDir, workdir).agents
}

export function loadMcp(config: ConfigService) {
  return existsSync(config.paths.mcp)
    ? parseMcpFile(JSON.parse(readFileSync(config.paths.mcp, 'utf8')))
    : parseMcpFile({})
}

export function prepareKernelConfig(input: PrepareInput) {
  const { config, secrets } = input
  const env = input.env ?? process.env
  const settings = config.getSettings()
  // 项目 Agent 不进内核配置：它随工作目录变，提示词随消息带上（kernelAgentOf、agentSystemPrompt）
  const agents = listAgents(config, input.builtinDir)
  // 读不了的 Agent 文件作为配置问题报出来、不启动内核，不能悄悄退回内置的同名 Agent
  if (agents.errors.length > 0) {
    return {
      ok: false as const,
      problems: agents.errors.map((e) => ({
        section: 'agent' as const,
        target: path.basename(e.path, '.md'),
        message: e.message,
      })),
    }
  }
  // 项目技能不列给内核：内核按会话目录自己去找（外部技能发现），这里只列内置和个人的
  const skills = loadSkills(config, input.builtinDir).skills
  return generateOpencodeConfig({
    settings,
    agents: agents.agents,
    mcp: loadMcp(config),
    skills: skills.filter((s) => s.enabled),
    disabledSkills: settings.skillsDisabled,
    // 个人记忆用绝对路径（存在才列，第一次建出来时会重启内核）；项目记忆写相对路径，内核按会话目录往上找。
    // OpenCode 关了项目配置，相对路径找不到，项目记忆走 projectInstructions；这一条是给 CodeAgent 的
    instructions: [
      ...(existsSync(config.paths.memory) ? [config.paths.memory] : []),
      PROJECT_MEMORY,
    ],
    gatewayKeys: Object.fromEntries(
      settings.gateways.flatMap((g) => {
        const key = secrets.get(gatewaySecretKey(g.id))
        return key ? [[g.id, key]] : []
      }),
    ),
    // MCP 配置里的 ${VAR}：先查密钥表的 env:<VAR>，再查环境变量
    lookupVar: (name) => secrets.get(`env:${name}`) ?? env[name],
    ...(input.kitsTools ? { kitsTools: input.kitsTools } : {}),
  })
}

export type { KernelConfig }

// 生成内核配置用到的设置字段；只有它们变了才需要重启内核（最近目录、外观等不算）
export function kernelSettingsKey(s: Settings): string {
  return JSON.stringify([s.gateways, s.defaultModel, s.skillsDisabled])
}
