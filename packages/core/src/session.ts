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
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  cost: number
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
}

export interface CreateSessionInput {
  text: string
  workdir: string
  agent: string
  model: string
  kernel: 'opencode' | 'codeagent'
  permissionMode: PermissionMode
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
