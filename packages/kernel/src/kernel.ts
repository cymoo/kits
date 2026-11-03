import type { AgentProfile, KernelEvent, PermissionDecision } from '@kits/core'

// 内核接口放在“会话”这一层：输入一份 Agent 配置和一句话，输出统一格式的事件流（phase1 方案 4.1 节）。

export type KernelId = 'codeagent' | 'opencode'

export interface KernelConfig {
  // 内核二进制的绝对路径
  binary: string
  // kits 为内核生成的配置目录
  configDir: string
  // 模型网关（OpenAI 兼容接口）
  gateway: { baseUrl: string; apiKey: string }
}

export interface UserInput {
  text: string
  // 附件先转成文本后随消息一起发
  attachments?: { name: string; text: string }[]
}

export interface FileDiff {
  path: string
  before: string
  after: string
}

export interface AgentKernel {
  readonly id: KernelId
  readonly capabilities: { subagents: boolean; revert: boolean }
  start(cfg: KernelConfig): Promise<void>
  createSession(opts: { profile: AgentProfile; workdir: string }): Promise<string>
  prompt(sessionId: string, input: UserInput): AsyncIterable<KernelEvent>
  respondPermission(requestId: string, decision: PermissionDecision): Promise<void>
  abort(sessionId: string): Promise<void>
  diff(sessionId: string): Promise<FileDiff[]>
  revert(sessionId: string, messageId: string): Promise<void>
  dispose(): Promise<void>
}

// 两个内核的差异收在这一层（phase1 方案 4.3 节）。
export interface KernelDialect {
  readonly id: KernelId
  spawn(cfg: KernelConfig): Promise<SpawnedKernel>
  writeConfig(dir: string, cfg: GeneratedConfig): Promise<void>
  permissionReplyPath(requestId: string, sessionId: string): string
}

export interface SpawnedKernel {
  baseUrl: string
  headers: Record<string, string>
  close(): Promise<void>
}

// kits 统一配置转换后的内核配置，形状在做配置转换时再细化
export interface GeneratedConfig {
  agents: Record<string, unknown>
  mcp: Record<string, unknown>
  permission: Record<string, unknown>
}
