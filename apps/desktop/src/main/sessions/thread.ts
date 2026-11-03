import type { KernelEvent, MessageView, PartPayload, PartView, SessionStatus } from '@kits/core'

// 一轮对话的事件 → 消息和 parts（phase1-implementation 5.2 节）。纯逻辑，不碰数据库：
// 返回这次变了哪些 part、消息有没有变、会话状态要不要变，由 SessionService 落库和推给界面。
// - 正文 / 思考的增量按内核的 partId 合并到同一个 part；
// - 工具按 callId 一个 part，开始时 running，结束时 completed / error；
// - 权限请求一个 part，状态 pending，会话进入 waiting；回复后回到 running。

export interface TurnChange {
  parts: PartView[]
  message?: MessageView
  status?: SessionStatus
  error?: string
}

export class TurnRecorder {
  private parts = new Map<string, PartView>()
  private seq = 0

  constructor(
    readonly sessionId: string,
    private message: MessageView,
    private readonly now: () => number = Date.now,
  ) {}

  get view(): MessageView {
    return this.message
  }

  private upsert(
    key: string,
    type: PartView['type'],
    update: (prev: PartPayload | undefined) => PartPayload,
    status?: string | null,
  ): PartView {
    const id = `${this.message.id}:${key}`
    const prev = this.parts.get(id)
    const at = this.now()
    const part: PartView = {
      id,
      messageId: this.message.id,
      sessionId: this.sessionId,
      seq: prev?.seq ?? this.seq++,
      type,
      payload: update(prev?.payload),
      status: status === undefined ? (prev?.status ?? null) : status,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    }
    this.parts.set(id, part)
    return part
  }

  // 用户回复了权限请求
  replyPermission(requestId: string, reply: string, message?: string): TurnChange {
    const id = `${this.message.id}:perm:${requestId}`
    if (!this.parts.has(id)) return { parts: [] }
    const part = this.upsert(
      `perm:${requestId}`,
      'permission',
      (prev) => ({
        ...(prev as Extract<PartPayload, { type: 'permission' }>),
        ...(message ? { message } : {}),
      }),
      reply,
    )
    const pending = [...this.parts.values()].some(
      (p) => p.type === 'permission' && p.status === 'pending',
    )
    return { parts: [part], status: pending ? 'waiting' : 'running' }
  }

  apply(event: KernelEvent): TurnChange {
    switch (event.type) {
      case 'text-delta':
      case 'reasoning-delta': {
        const type = event.type === 'text-delta' ? 'text' : 'reasoning'
        const part = this.upsert(`${type}:${event.partId}`, type, (prev) => ({
          type,
          text: ((prev as { text?: string } | undefined)?.text ?? '') + event.text,
        }))
        return { parts: [part] }
      }
      case 'tool-start':
        return {
          parts: [
            this.upsert(
              `tool:${event.callId}`,
              'tool',
              () => ({ type: 'tool', callId: event.callId, name: event.name, input: event.input }),
              'running',
            ),
          ],
        }
      case 'tool-end':
        return {
          parts: [
            this.upsert(
              `tool:${event.callId}`,
              'tool',
              (prev) => ({
                ...((prev as Extract<PartPayload, { type: 'tool' }>) ?? {
                  type: 'tool',
                  callId: event.callId,
                  name: 'unknown',
                  input: {},
                }),
                output: event.output,
                ...(event.error ? { error: event.error } : {}),
                ...(event.title ? { title: event.title } : {}),
              }),
              event.error ? 'error' : 'completed',
            ),
          ],
        }
      case 'permission-request':
        return {
          parts: [
            this.upsert(
              `perm:${event.requestId}`,
              'permission',
              () => ({
                type: 'permission',
                requestId: event.requestId,
                tool: event.tool,
                input: event.input,
                patterns: event.patterns,
                always: event.always,
                ...(event.callId ? { callId: event.callId } : {}),
              }),
              'pending',
            ),
          ],
          status: 'waiting',
        }
      case 'retry':
        return {
          parts: [
            this.upsert(`retry:${event.attempt}`, 'retry', () => ({
              type: 'retry',
              attempt: event.attempt,
              message: event.message,
              nextAt: event.nextAt,
            })),
          ],
        }
      case 'compaction':
        return {
          parts: [
            this.upsert(`compaction:${this.seq}`, 'compaction', () => ({
              type: 'compaction',
              summary: event.summary,
            })),
          ],
        }
      case 'usage': {
        const t = this.message.tokens
        this.message = {
          ...this.message,
          tokens: {
            input: t.input + event.inputTokens,
            output: t.output + event.outputTokens,
            cacheRead: t.cacheRead + event.cacheReadTokens,
            cacheWrite: t.cacheWrite + event.cacheWriteTokens,
          },
          cost: this.message.cost + event.cost,
        }
        return { parts: [], message: this.message }
      }
      case 'done': {
        this.message = { ...this.message, completedAt: this.now(), finishReason: event.reason }
        const status: SessionStatus =
          event.reason === 'completed' ? 'done' : event.reason === 'aborted' ? 'aborted' : 'error'
        const change: TurnChange = { parts: [], message: this.message, status }
        // 出错的轮次在对话流里留一个出错块，原因写在里面（PR8 做成完整的出错卡片）
        if (status === 'error') {
          const message = event.error ?? (event.reason === 'max-steps' ? '超出最大步数' : '出错了')
          change.parts.push(this.upsert('error', 'error', () => ({ type: 'error', message })))
          change.error = message
        }
        return change
      }
      case 'status':
        return { parts: [] }
    }
  }
}
