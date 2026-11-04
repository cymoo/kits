import type { PermissionMode } from './config/permission'
import type { PermissionReply } from './events'

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
  // 运行中发的消息，这一轮结束后一起发出去（不落库）
  queued?: string[]
}

export interface MessageView {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
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
      name: string
      input: unknown
      output?: unknown
      error?: string
      title?: string
      exitCode?: number
      durationMs?: number
    }
  | {
      type: 'permission'
      requestId: string
      tool: string
      input: unknown
      patterns: string[]
      always: string[]
      callId?: string
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
  // tool：running / completed / error；permission：pending / 回复；其他为空
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

// 发消息时带的附件：渲染进程读成字节发过来，主进程存到 {userData}/attachments/<会话>/ 并转成文本
export interface AttachmentInput {
  name: string
  mime: string
  data: Uint8Array
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
