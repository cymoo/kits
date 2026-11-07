import type { PermissionMode, PermissionRisk } from './config/permission'
import type { PermissionReply, ToolFileChange } from './events'

// 会话在主进程和界面之间的形状（phase1-implementation 5.2、6.4 节）。数据库行转成这个再推给界面。
// 只有类型，渲染进程经 ipc.ts 引用。

export type SessionStatus = 'running' | 'waiting' | 'done' | 'error' | 'aborted'

export interface SessionSummary {
  id: string
  title: string
  agent: string
  kernel: 'opencode' | 'codeagent'
  workdir: string
  model: string
  permissionMode: PermissionMode
  status: SessionStatus
  turns: number
  createdAt: number
  updatedAt: number
  lastError: string | null
  // 置顶的时间，没置顶为 null
  pinnedAt: number | null
  // 运行中发的消息，这一轮结束后一起发出去（不落库）
  queued?: QueuedMessage[]
  // 这一轮的内核支持插话
  canInterject?: boolean
}

export interface QueuedMessage {
  id: string
  text: string
  attachments: { name: string; size: number }[]
}

export interface MessageView {
  id: string
  sessionId: string
  // notice 是对话里的留痕（改了权限、模型），不是谁说的话，text 是 `permission:<模式>` 或 `model:<模型>`
  role: 'user' | 'assistant' | 'notice'
  turn: number
  // 用户消息的正文；助手消息为空，内容在 parts
  text: string
  createdAt: number
  completedAt: number | null
  finishReason: string | null
  // 整轮累计；input 已经含缓存读写
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  cost: number
  // 这一轮最后一次模型调用的输入 token，也就是现在上下文有多大
  contextTokens: number
}

export type PartPayload =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool'
      callId: string
      // 子任务里的工具：派它的 task 工具的 callId
      parentCallId?: string
      name: string
      input: unknown
      output?: unknown
      error?: string
      title?: string
      exitCode?: number
      durationMs?: number
      additions?: number
      deletions?: number
      count?: number
      // 这一步改了哪些文件，带 diff；改动面板在内核没给这一轮的快照 diff 时用它
      files?: ToolFileChange[]
    }
  | {
      type: 'permission'
      requestId: string
      tool: string
      input: unknown
      patterns: string[]
      always: string[]
      // 为什么值得问，卡片先说这个
      risk?: PermissionRisk
      callId?: string
      subagent?: boolean
      reply?: PermissionReply
      message?: string
    }
  | {
      // ask_user：blocking 时 Agent 在等，不阻塞时它先按 assumption 做，回答作为下一条消息发过去
      type: 'question'
      questionId: string
      question: string
      options: string[]
      assumption?: string
      blocking: boolean
      answer?: string
    }
  // 运行中插的话。kernelTurn：它是内核会话里第几条用户消息
  | {
      type: 'interject'
      text: string
      // id、mime：图片要显示缩略图，这两项之前的旧会话没有
      attachments: { name: string; size: number; id?: string; mime?: string }[]
      kernelTurn: number
    }
  | { type: 'retry'; attempt: number; message: string; nextAt: number }
  | { type: 'compaction'; summary: string }
  | { type: 'error'; message: string }

export type PartType = PartPayload['type']

export interface PartView {
  id: string
  messageId: string
  sessionId: string
  seq: number
  type: PartType
  payload: PartPayload
  // tool：running / completed / error；permission：pending / 回复；interject：pending / sent；其他为空
  status: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionDetail {
  session: SessionSummary
  messages: MessageView[]
  parts: PartView[]
  attachments: AttachmentView[]
}

// 发消息时带的附件：渲染进程读成字节发过来，主进程存到 {userData}/attachments/<会话>/，文档转成文本，图片原样交给内核
export interface AttachmentInput {
  name: string
  mime: string
  data: Uint8Array
}

// 退回输入框的排队消息
export interface QueuedDraft {
  text: string
  attachments: AttachmentInput[]
}

// 用户消息下面的附件芯片
export interface AttachmentView {
  id: string
  messageId: string | null
  name: string
  mime: string
  size: number
}

export interface CreateSessionInput {
  text: string
  workdir: string
  agent: string
  model: string
  kernel: 'opencode' | 'codeagent'
  permissionMode: PermissionMode
  attachments?: AttachmentInput[]
  // 这个会话里不用的 MCP 服务（输入框 + 菜单里关掉的）
  mcpOff?: string[]
}

// 一轮改了的一个文件（改动面板）。内核在这一轮结束后才算出来，落库后推给界面
export interface FileDiffView {
  turn: number
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  // unified diff
  patch: string
}

// 一轮的产出（产出面板）。AI 原稿和人工修改分开存，导出评测数据时用
export type OutputView = {
  id: string
  sessionId: string
  turn: number
  editedAt: number | null
  exportedAt: number | null
  exportFormat: 'markdown' | 'json' | null
} & (
  | { kind: 'text'; aiDraft: string; edited: string | null }
  | { kind: 'structured'; aiDraft: unknown; edited: unknown | null }
)

// 文件面板：目录里的一项，path 是相对工作区的路径，分隔符一律是 /
export interface FileEntry {
  name: string
  path: string
  dir: boolean
}

export type FilePreview =
  | { kind: 'text'; text: string; size: number; truncated: boolean }
  | { kind: 'image'; dataUrl: string; size: number }
  | { kind: 'pdf'; data: Uint8Array; size: number }
  // Word 转出来的 HTML，放进沙箱 iframe 显示
  | { kind: 'html'; html: string; size: number }
  | { kind: 'unsupported'; reason: 'binary' | 'large'; size: number }

// ⌘K 搜会话：命中的部分夹在 \u0001 和 \u0002 之间，渲染进程按它高亮
export interface SessionSearchHit {
  session: SessionSummary
  title: string
  // 正文里命中的那一段；只有标题命中时为 null
  snippet: string | null
}

// 内核报告的忙闲（状态行用），不落库
export interface SessionActivity {
  sessionId: string
  state: 'busy' | 'idle' | 'retry'
  at: number
}

export interface AgentSummary {
  name: string
  description: string
  source: 'builtin' | 'personal' | 'project'
  model?: string
}

// 首次引导：选了工作目录后显示它的 Git 状态
export interface WorkdirInspection {
  path: string
  // 不是 Git 仓库就没有；changed 是工作区里有改动的文件数
  git?: { branch: string; changed: number }
}
