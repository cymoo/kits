import type { KernelEvent, MessageView, PartPayload, PartView, SessionStatus } from '@kits/core'

// 一轮对话的事件 → 消息和 parts（phase1-implementation 5.2 节）。纯逻辑，不碰数据库：
// 返回这次变了哪些 part、消息有没有变、会话状态要不要变，由 SessionService 落库和推给界面。
// - 正文 / 思考的增量按内核的 partId 合并到同一个 part；
// - 工具按 callId 一个 part，开始时 running，结束时 completed / error；
// - 权限请求、阻塞提问各一个 part，状态 pending，会话进入 waiting；都回复了回到 running；
//   这一轮结束时还没回复的标成 expired（不阻塞的提问除外）；
// - 插话一条一个 part，模型看到之前是 pending，看到时才定下它在这一轮里的位置。

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

  // 回复正文：最后一个工具之后的文字（和会话页的“正文”块一样）
  answerText(): string {
    const ordered = [...this.parts.values()].sort((a, b) => a.seq - b.seq)
    const lastWork = ordered.findLastIndex((p) => p.type === 'tool' || p.type === 'interject')
    return ordered
      .slice(lastWork + 1)
      .flatMap((p) => (p.payload.type === 'text' ? [p.payload.text] : []))
      .join('')
      .trim()
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

  // ask_user 进来了：记一个提问 part；阻塞的提问让会话进入 waiting
  question(
    questionId: string,
    input: {
      question: string
      options?: string[] | undefined
      assumption?: string | undefined
      blocking: boolean
    },
  ): TurnChange {
    const part = this.upsert(
      `question:${questionId}`,
      'question',
      () => ({
        type: 'question',
        questionId,
        question: input.question,
        options: input.options ?? [],
        ...(input.assumption ? { assumption: input.assumption } : {}),
        blocking: input.blocking,
      }),
      'pending',
    )
    return { parts: [part], ...(input.blocking ? { status: 'waiting' as const } : {}) }
  }

  answer(questionId: string, answer: string): TurnChange {
    const id = `${this.message.id}:question:${questionId}`
    if (!this.parts.has(id)) return { parts: [] }
    const part = this.upsert(
      `question:${questionId}`,
      'question',
      (prev) => ({ ...(prev as Extract<PartPayload, { type: 'question' }>), answer }),
      'answered',
    )
    return { parts: [part], status: this.waitingOn() ? 'waiting' : 'running' }
  }

  // 还有没回复的权限请求或阻塞提问
  private waitingOn(): boolean {
    return [...this.parts.values()].some(
      (p) =>
        p.status === 'pending' &&
        (p.type === 'permission' || (p.payload.type === 'question' && p.payload.blocking)),
    )
  }

  // 插话已经交给内核了
  interject(
    id: string,
    text: string,
    attachments: { name: string; size: number }[],
    kernelTurn: number,
  ): TurnChange {
    const part = this.upsert(
      `interject:${id}`,
      'interject',
      () => ({ type: 'interject', text, attachments, kernelTurn }),
      'pending',
    )
    return { parts: [part] }
  }

  // 模型看到了：排到这时候的位置，等待期间到的步骤算在它前面
  private settleInterjects(): PartView[] {
    const at = this.now()
    return [...this.parts.values()]
      .filter((p) => p.type === 'interject' && p.status === 'pending')
      .map((p) => {
        const part = { ...p, seq: this.seq++, status: 'sent', updatedAt: at }
        this.parts.set(p.id, part)
        return part
      })
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
    return { parts: [part], status: this.waitingOn() ? 'waiting' : 'running' }
  }

  // 用户回复时内核里已经没有这个请求了：收起卡片，不算用户的决定
  expirePermission(requestId: string): TurnChange {
    return this.settlePermission(requestId, 'expired')
  }

  // 还没回复的请求改成新状态；已经回复过的不动（用户自己回复时内核也会发事件，和这边谁先到都行）
  private settlePermission(requestId: string, status: string): TurnChange {
    const key = `perm:${requestId}`
    const prev = this.parts.get(`${this.message.id}:${key}`)
    if (prev?.status !== 'pending') return { parts: [] }
    const part = this.upsert(key, 'permission', (p) => p as PartPayload, status)
    return { parts: [part], status: this.waitingOn() ? 'waiting' : 'running' }
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
              () => ({
                type: 'tool',
                callId: event.callId,
                ...(event.parentCallId ? { parentCallId: event.parentCallId } : {}),
                name: event.name,
                input: event.input,
              }),
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
                ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
                ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
                ...(event.additions !== undefined ? { additions: event.additions } : {}),
                ...(event.deletions !== undefined ? { deletions: event.deletions } : {}),
                ...(event.count !== undefined ? { count: event.count } : {}),
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
                ...(event.subagent ? { subagent: true } : {}),
              }),
              'pending',
            ),
          ],
          status: 'waiting',
        }
      case 'permission-replied':
        return this.settlePermission(event.requestId, event.reply)
      case 'interject-delivered':
        return { parts: this.settleInterjects() }
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
          contextTokens: event.inputTokens,
        }
        return { parts: [], message: this.message }
      }
      case 'done': {
        this.message = { ...this.message, completedAt: this.now(), finishReason: event.reason }
        const status: SessionStatus =
          event.reason === 'completed' ? 'done' : event.reason === 'aborted' ? 'aborted' : 'error'
        // 停止了也留在内核的历史里，下一轮模型能看到
        const change: TurnChange = { parts: this.settleInterjects(), message: this.message, status }
        // 这一轮结束了，还没回复的确认 / 提问作废，卡片上不再给按钮
        for (const p of [...this.parts.values()]) {
          // 不阻塞的提问轮次结束后还能回答（回答作为下一条消息）
          if (p.status !== 'pending' || (p.payload.type === 'question' && !p.payload.blocking))
            continue
          const key = p.id.slice(this.message.id.length + 1)
          change.parts.push(this.upsert(key, p.type, (prev) => prev as PartPayload, 'expired'))
        }
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
