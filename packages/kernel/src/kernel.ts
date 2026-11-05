import type { KernelEvent, PermissionReply, PermissionRule } from '@kits/core'

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
  // 子进程的 stdout / stderr 追加写到这个文件；不传就只留在内存里（最后 64 KB）
  logFile?: string
}

// 内核进程意外退出（不是 close 关掉的）
export interface KernelExit {
  code: number | null
  signal: string | null
  // stdout / stderr 的最后几十行，出错卡片上显示
  tail: string
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
  // 按会话模式解析好的完整权限（agentPermissions 的结果，有顺序，后面的优先）
  permission: PermissionRule[]
}

export interface UserInput {
  text: string
  // 追加的系统提示词：项目 Agent 不进内核配置（内核配置全局一份，项目 Agent 随工作目录变），
  // 它的提示词每条消息随身带上
  system?: string
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
  // 哪一轮（那一轮的用户消息 id）改的；同一个文件可能在几轮里各出现一次
  messageId?: string
  // 第几轮（内核会话里第几条用户消息，从 1 开始）
  turn?: number
}

// 内核存的消息，断线补齐和恢复会话用；parts 的形状随内核走，只有适配器解读
export interface KernelMessage {
  info: { id?: string; role?: string; time?: { created?: number; completed?: number } }
  parts: unknown[]
}

export interface CompactionResult {
  summary: string
  // 摘要本身的 token 数（压缩后上下文从这里重新算）；内核没给就是 0
  tokens: number
}

export interface AgentKernel {
  readonly id: KernelId
  readonly capabilities: { subagents: boolean; revert: boolean }
  start(cfg: KernelConfig): Promise<void>
  createSession(opts: CreateSessionOptions): Promise<KernelSession>
  // 一轮对话：事件流以一条 done 结束
  prompt(session: KernelSession, input: UserInput): AsyncIterable<KernelEvent>
  // 拒绝时 message 作为反馈交给模型。内核里已经没有这个请求时返回 false
  respondPermission(
    session: KernelSession,
    requestId: string,
    reply: PermissionReply,
    message?: string,
  ): Promise<boolean>
  abort(session: KernelSession): Promise<void>
  diff(session: KernelSession): Promise<FileDiff[]>
  // 上下文压缩：等内核把前面的对话压成摘要，返回摘要正文和它占多少 token
  summarize(session: KernelSession): Promise<CompactionResult>
  messages(session: KernelSession): Promise<KernelMessage[]>
  revert(session: KernelSession, messageId: string): Promise<void>
  // 进程意外退出时通知；正在跑的轮次会先各自收到 done: error
  onExit(listener: (exit: KernelExit) => void): void
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
  // 列出待处理权限请求的接口（断线补齐用）
  readonly permissionListPath: string
}

export interface SpawnedKernel {
  baseUrl: string
  headers: Record<string, string>
  onExit(listener: (exit: KernelExit) => void): void
  close(): Promise<void>
}

// kits 统一配置转换后的内核配置：要写进配置目录的文件（路径相对 configDir）和子进程环境变量
export interface GeneratedFiles {
  files: { path: string; content: string }[]
  env: Record<string, string>
}
