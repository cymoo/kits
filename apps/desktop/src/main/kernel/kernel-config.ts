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
// 现在只有内置和个人两级；项目级（<工作目录>/.agents）的 Agent、技能、记忆随 PR13、PR14、PR16 加。

export interface KernelDirs {
  config: string
  data: string
  logs: string
}

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

// 内置和个人两级 Agent，按来源合并（会话服务建会话时也用）
export function loadAgents(config: ConfigService) {
  return mergeBySource([builtinAssistant], loadAgentsDir(config.paths.agents, 'personal').items)
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
  const agents = loadAgentsDir(config.paths.agents, 'personal')
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
    agents: loadAgents(config),
    mcp: loadMcp(config),
    skills: skills.filter((s) => s.enabled),
    disabledSkills: settings.skillsDisabled,
    instructions: existsSync(config.paths.memory) ? [config.paths.memory] : [],
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
