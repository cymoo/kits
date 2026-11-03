import type { KernelEvent, PermissionReply, PermissionSet } from '@kits/core'

// 内核接口放在“会话”这一层：输入一份 Agent 配置和一句话，输出统一格式的事件流（phase1 方案 4.1 节）。
// 会话用 KernelSession 整个传进来（id + 工作目录 + Agent + 模型），适配器不记会话：
// 应用重启后从数据库读出来照样能续上，OpenCode 按工作目录分实例，每个请求都要带目录。

export type KernelId = 'codeagent' | 'opencode'

export interface KernelConfig {
  // 内核二进制的绝对路径
  binary: string
  // kits 为内核生成的配置目录
  configDir: string
  // 内核的数据目录（会话存储、缓存、日志）。指到 kits 的用户数据目录下，不让内核读写用户家目录
  dataDir: string
  // 只给子进程的环境变量：网关 key、MCP 的 `${VAR}`、kits 工具 token。配置文件里只写 `{env:…}`
  env: Record<string, string>
}

export interface KernelSession {
  // 内核里的会话 id
  id: string
  workdir: string
  // kits 的 Agent 名（不带内核前缀）
  agent: string
  // `<网关 id>/<模型 id>`，空则用内核配置里的默认模型
  model?: string
}

export interface CreateSessionOptions {
  workdir: string
  agent: string
  model?: string
  title?: string
  // 按会话模式解析好的完整权限（agentPermissions 的结果）
  permission: PermissionSet
}

export interface UserInput {
  text: string
  // 附件先转成文本后随消息一起发
  attachments?: { name: string; text: string }[]
}

// 一个文件在整个会话里的改动，patch 是 unified diff
export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  patch: string
}

// 内核存的消息，断线补齐和恢复会话用；parts 的形状随内核走，只有适配器解读
export interface KernelMessage {
  info: { id?: string; role?: string; time?: { created?: number; completed?: number } }
  parts: unknown[]
}

export interface AgentKernel {
  readonly id: KernelId
  readonly capabilities: { subagents: boolean; revert: boolean }
  start(cfg: KernelConfig): Promise<void>
  createSession(opts: CreateSessionOptions): Promise<KernelSession>
  // 一轮对话：事件流以一条 done 结束
  prompt(session: KernelSession, input: UserInput): AsyncIterable<KernelEvent>
  // 拒绝时 message 作为反馈交给模型
  respondPermission(
    session: KernelSession,
    requestId: string,
    reply: PermissionReply,
    message?: string,
  ): Promise<void>
  abort(session: KernelSession): Promise<void>
  diff(session: KernelSession): Promise<FileDiff[]>
  // 上下文压缩
  summarize(session: KernelSession): Promise<void>
  messages(session: KernelSession): Promise<KernelMessage[]>
  revert(session: KernelSession, messageId: string): Promise<void>
  dispose(): Promise<void>
}

// 两个内核的差异收在这一层（phase1 方案 4.3 节）。
export interface KernelDialect {
  readonly id: KernelId
  // HTTP 接口的路径前缀：OpenCode 为空，CodeAgent 是 /api/v1
  readonly apiPrefix: string
  spawn(cfg: KernelConfig): Promise<SpawnedKernel>
  // 把配置转换的结果写进 configDir；env 不落盘，由调用方放进 KernelConfig.env
  writeConfig(dir: string, generated: GeneratedFiles): Promise<void>
  permissionReplyPath(requestId: string, sessionId: string): string
}

export interface SpawnedKernel {
  baseUrl: string
  headers: Record<string, string>
  close(): Promise<void>
}

// kits 统一配置转换后的内核配置：要写进配置目录的文件（路径相对 configDir）和子进程环境变量
export interface GeneratedFiles {
  files: { path: string; content: string }[]
  env: Record<string, string>
}
