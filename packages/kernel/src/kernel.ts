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
  // 随应用带的工具目录（ripgrep），加到子进程 PATH 最前面
  toolsDir?: string
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

// 随消息发的附件：文档已经转成文本，图片是 data URL
export type KernelAttachment =
  | { name: string; text: string }
  | { name: string; mime: string; dataUrl: string }

export interface UserInput {
  text: string
  // 追加的系统提示词：项目 Agent 不进内核配置（内核配置全局一份，项目 Agent 随工作目录变），
  // 它的提示词每条消息随身带上
  system?: string
  attachments?: KernelAttachment[]
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

export type KernelPermissionReply = Exclude<PermissionReply, 'always'>

export interface AgentKernel {
  readonly id: KernelId
  // projectInstructions：内核自己读项目的 AGENTS.md 和记忆，不读的 kits 随消息带上
  readonly capabilities: {
    subagents: boolean
    revert: boolean
    interject: boolean
    projectInstructions: boolean
  }
  start(cfg: KernelConfig): Promise<void>
  createSession(opts: CreateSessionOptions): Promise<KernelSession>
  // 一轮对话：事件流以一条 done 结束
  prompt(session: KernelSession, input: UserInput): AsyncIterable<KernelEvent>
  // 拒绝时 message 作为反馈交给模型。内核里已经没有这个请求时返回 false。
  // 没有 always：内核记的 always 按工作目录共享，还盖得过 deny，“本会话允许”由 kits 自己记
  respondPermission(
    session: KernelSession,
    requestId: string,
    reply: KernelPermissionReply,
    message?: string,
  ): Promise<boolean>
  // 改这个内核会话的权限：rules 是新的完整规则串，下一次工具调用起生效，这一轮还在跑也一样
  setPermission(session: KernelSession, rules: PermissionRule[]): Promise<void>
  // 插话：这一轮还在跑时再发一条，模型下一步看到，还算同一轮。这一轮已经不在了、内核不支持时返回 false
  interject(session: KernelSession, input: UserInput): Promise<boolean>
  abort(session: KernelSession): Promise<void>
  diff(session: KernelSession): Promise<FileDiff[]>
  // 上下文压缩：等内核把前面的对话压成摘要，返回摘要正文和它占多少 token
  summarize(session: KernelSession): Promise<CompactionResult>
  messages(session: KernelSession): Promise<KernelMessage[]>
  revert(session: KernelSession, messageId: string): Promise<void>
  // 删内核里的会话和它的消息。内核里已经没有这个会话也算删掉了
  deleteSession(session: Pick<KernelSession, 'id' | 'workdir'>): Promise<void>
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
  // 运行中再发消息会并进这一轮。不支持的内核，排队的消息等这一轮结束再发
  readonly interject: boolean
  // 内核自己读项目的 AGENTS.md 和记忆
  readonly projectInstructions: boolean
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
