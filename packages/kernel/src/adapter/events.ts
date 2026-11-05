import type { DoneReason, KernelEvent, PermissionReply } from '@kits/core'

// OpenCode 系 SSE 事件 → KernelEvent（映射表见 docs/references/model-poc.md“对 KernelEvent 映射和适配器的启示”）。
// 一轮 prompt 一个映射器，按 sessionID 过滤。有状态：
// - messageID → role：用户消息的 part 不算回复；
// - partID → 已发出的文本长度：增量（message.part.delta）和整段（message.part.updated 带 text）都能来，
//   只发没发过的那一截，断线补齐时把整段消息重放一遍也不会重复；
// - callID → 工具阶段：pending 时 input 还是空的，到 running 才发 tool-start，completed / error 发 tool-end；
// - 子会话 id → 派它的 task 工具的 callID：task 工具在内核里开子会话跑，子会话的事件带自己的 sessionID。
//   权限请求要接住，不然子任务一直等下去；工具步骤带上 parentCallId 显示在子任务下面；
//   其余事件不算这一轮的（子会话的 session.idle 不代表这一轮结束）。
//   子任务里工具的 callId 写成 <task 的 callID>/<callID>：不同会话的 callID 可能撞。

interface RawEvent {
  type?: string
  properties?: Record<string, unknown>
}

interface RawPart {
  id?: string
  messageID?: string
  sessionID?: string
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
  tool?: string
  callID?: string
  state?: {
    status?: string
    input?: unknown
    output?: unknown
    error?: string
    title?: string
    // bash 的 metadata 里有 exit
    metadata?: Record<string, unknown>
    time?: { start?: number; end?: number }
  }
}

interface RawSessionInfo {
  id?: string
  parentID?: string
}

interface RawMessageInfo {
  id?: string
  sessionID?: string
  role?: string
  time?: { created?: number; completed?: number }
  cost?: number
  // 这一步失败时内核写在消息上的错误（断线期间的 session.error 靠它补回来）
  error?: unknown
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }
}

export interface RawMessage {
  info: RawMessageInfo
  parts: RawPart[]
}

// 别的内核用的事件名（CodeAgent 文档里的写法）先归一成 OpenCode 的
const ALIASES: Record<string, string> = {
  'permission.requested': 'permission.asked',
}

// 步骤行右边的数字。edit 的 metadata 带 filediff，grep 是 matches，glob 是 count，read 是 display.totalLines
function toolStats(metadata: Record<string, unknown> | undefined): {
  additions?: number
  deletions?: number
  count?: number
} {
  const diff = metadata?.filediff as { additions?: unknown; deletions?: unknown } | undefined
  const display = metadata?.display as { totalLines?: unknown } | undefined
  const count = [metadata?.matches, metadata?.count, display?.totalLines].find(
    (n) => typeof n === 'number',
  )
  return {
    ...(typeof diff?.additions === 'number' ? { additions: diff.additions } : {}),
    ...(typeof diff?.deletions === 'number' ? { deletions: diff.deletions } : {}),
    ...(typeof count === 'number' ? { count } : {}),
  }
}

export interface OpencodeEventMapper {
  map(event: unknown): KernelEvent[]
  // 断线重连后用 GET /session/{id}/message 的结果补齐（调用方先去掉这一轮之前就有的消息）
  // from：这些消息属于哪个子会话，不传是主会话
  backfill(messages: RawMessage[], from?: string): KernelEvent[]
  // 这一轮到现在知道的子会话，断线补齐时逐个拉消息
  readonly subsessions: string[]
  // 断线重连后用 GET /permission 的结果补上漏掉的权限请求，按 requestId 去重
  permissions(pending: unknown[]): KernelEvent[]
  // 调了 abort 之后收到的结束事件都算 aborted
  markAborted(): void
  // 适配器自己判定结束（轮询兜底、卡死）时调用；已经结束就返回空
  finish(reason: DoneReason, error?: string): KernelEvent[]
  readonly done: boolean
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error ?? 'unknown error')
  const e = error as { name?: string; data?: { message?: string }; message?: string }
  return e.data?.message ?? e.message ?? e.name ?? 'unknown error'
}

export function createOpencodeEventMapper(sessionId: string): OpencodeEventMapper {
  const roles = new Map<string, string>()
  const partTypes = new Map<string, string>()
  const emitted = new Map<string, number>()
  const toolPhase = new Map<string, 'started' | 'ended'>()
  const usageSent = new Set<string>()
  const permissionsSent = new Set<string>()
  const subsessions = new Map<string, string | undefined>()
  let lastRetry = ''
  // 助手消息上带的错误：轮询收尾时按出错结束，不当成功
  let messageError: string | undefined
  let aborted = false
  let done = false

  const isUserPart = (part: RawPart) => !!part.messageID && roles.get(part.messageID) === 'user'

  function text(
    partId: string,
    kind: 'text' | 'reasoning',
    full: string | undefined,
    delta?: string,
  ) {
    const sent = emitted.get(partId) ?? 0
    let chunk = ''
    if (delta !== undefined) chunk = delta
    else if (full !== undefined && full.length > sent) chunk = full.slice(sent)
    if (!chunk) return []
    emitted.set(partId, sent + chunk.length)
    return [
      kind === 'text'
        ? { type: 'text-delta' as const, partId, text: chunk }
        : { type: 'reasoning-delta' as const, partId, text: chunk },
    ]
  }

  // task 工具运行时 metadata 里有子会话 id：session.created 丢在断线里时靠消息快照里的它补回来
  function noteSubsession(part: RawPart) {
    const id = part.state?.metadata?.sessionId
    if (part.tool !== 'task' || typeof id !== 'string') return
    // 子任务再派子任务时算在最外面那个 task 下面
    subsessions.set(id, subsessions.get(part.sessionID ?? '') ?? part.callID)
  }

  function toolEvents(part: RawPart, callId: string, parentCallId?: string): KernelEvent[] {
    const status = part.state?.status
    if (status !== 'running' && status !== 'completed' && status !== 'error') return []
    const out: KernelEvent[] = []
    const phase = toolPhase.get(callId)
    if (!phase) {
      toolPhase.set(callId, 'started')
      out.push({
        type: 'tool-start',
        callId,
        name: part.tool ?? 'unknown',
        input: part.state?.input ?? {},
        ...(parentCallId ? { parentCallId } : {}),
      })
    }
    if ((status === 'completed' || status === 'error') && phase !== 'ended') {
      toolPhase.set(callId, 'ended')
      out.push({
        type: 'tool-end',
        callId,
        output: part.state?.output ?? null,
        ...(status === 'error' ? { error: part.state?.error ?? 'tool failed' } : {}),
        ...(part.state?.title ? { title: part.state.title } : {}),
        ...(typeof part.state?.metadata?.exit === 'number'
          ? { exitCode: part.state.metadata.exit }
          : {}),
        ...(part.state?.time?.start && part.state.time.end
          ? { durationMs: part.state.time.end - part.state.time.start }
          : {}),
        ...toolStats(part.state?.metadata),
      })
    }
    return out
  }

  // 子会话的 part：只要工具步骤，它的正文、思考汇总在 task 工具的结果里
  function onSubPart(part: RawPart, from: string): KernelEvent[] {
    noteSubsession({ ...part, sessionID: from })
    const parent = subsessions.get(from)
    if (part.type !== 'tool' || !part.callID || !parent) return []
    return toolEvents(part, `${parent}/${part.callID}`, parent)
  }

  function onPart(part: RawPart): KernelEvent[] {
    if (!part.id || !part.type) return []
    partTypes.set(part.id, part.type)
    noteSubsession(part)
    if (isUserPart(part) || part.synthetic || part.ignored) return []
    if (part.type === 'text' || part.type === 'reasoning') {
      return text(part.id, part.type, part.text)
    }
    if (part.type === 'tool' && part.callID) return toolEvents(part, part.callID)
    return []
  }

  function onMessage(info: RawMessageInfo): KernelEvent[] {
    if (!info.id) return []
    if (info.role) roles.set(info.id, info.role)
    if (info.role === 'assistant' && info.error) {
      if ((info.error as { name?: string }).name === 'MessageAbortedError') aborted = true
      else messageError = errorMessage(info.error)
    }
    if (info.role !== 'assistant' || !info.time?.completed || usageSent.has(info.id)) return []
    usageSent.add(info.id)
    const t = info.tokens ?? {}
    const cacheRead = num(t.cache?.read)
    const cacheWrite = num(t.cache?.write)
    return [
      {
        type: 'usage',
        inputTokens: num(t.input) + cacheRead + cacheWrite,
        outputTokens: num(t.output),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        cost: num(info.cost),
      },
    ]
  }

  function finish(reason: DoneReason, error?: string): KernelEvent[] {
    if (done) return []
    done = true
    if (reason === 'completed' && !aborted && messageError !== undefined) {
      return [{ type: 'done', reason: 'error', error: messageError }]
    }
    const final = aborted ? 'aborted' : reason
    return [
      final === 'error' && error !== undefined
        ? { type: 'done', reason: final, error }
        : { type: 'done', reason: final },
    ]
  }

  function map(event: unknown): KernelEvent[] {
    if (done || typeof event !== 'object' || event === null) return []
    const raw = event as RawEvent
    const type = ALIASES[raw.type ?? ''] ?? raw.type
    const p = raw.properties ?? {}
    if (type === 'session.created' || type === 'session.updated') {
      const info = (p.info ?? {}) as RawSessionInfo
      const parent = info.parentID ?? ''
      if (info.id && (parent === sessionId || subsessions.has(parent)) && !subsessions.has(info.id))
        subsessions.set(info.id, subsessions.get(parent))
      return []
    }
    const sub = subsessions.has(p.sessionID as string)
    if (type === 'message.part.updated' && sub) {
      return onSubPart((p.part ?? {}) as RawPart, p.sessionID as string)
    }
    const asked = type === 'permission.asked' && sub
    const replied = type === 'permission.replied' && sub
    if (p.sessionID !== undefined && p.sessionID !== sessionId && !asked && !replied) return []
    switch (type) {
      case 'message.updated':
        return onMessage((p.info ?? {}) as RawMessageInfo)
      case 'message.part.updated': {
        const part = (p.part ?? {}) as RawPart
        if (part.sessionID !== undefined && part.sessionID !== sessionId) return []
        return onPart(part)
      }
      case 'message.part.delta': {
        const partId = p.partID as string | undefined
        if (!partId || p.field !== 'text' || typeof p.delta !== 'string') return []
        if (roles.get(p.messageID as string) === 'user') return []
        const kind = partTypes.get(partId)
        // 没见过 part.updated 的增量当正文：OpenCode 总是先发 part 再发增量，这里只是兜底
        return text(partId, kind === 'reasoning' ? 'reasoning' : 'text', undefined, p.delta)
      }
      case 'permission.asked': {
        if ((p.sessionID !== sessionId && !asked) || permissionsSent.has(String(p.id))) return []
        permissionsSent.add(String(p.id))
        const tool = p.tool as { callID?: string } | undefined
        const parent = subsessions.get(p.sessionID as string)
        const callId = parent && tool?.callID ? `${parent}/${tool.callID}` : tool?.callID
        return [
          {
            type: 'permission-request',
            requestId: String(p.id),
            tool: String(p.permission),
            input: p.metadata ?? {},
            patterns: (p.patterns as string[] | undefined) ?? [],
            always: (p.always as string[] | undefined) ?? [],
            ...(callId ? { callId } : {}),
            ...(asked ? { subagent: true } : {}),
          },
        ]
      }
      case 'permission.replied':
        return [
          {
            type: 'permission-replied',
            requestId: String(p.requestID),
            reply: p.reply as PermissionReply,
          },
        ]
      case 'session.status': {
        if (p.sessionID !== sessionId) return []
        const status = (p.status ?? {}) as {
          type?: string
          attempt?: number
          message?: string
          next?: number
        }
        if (status.type === 'retry') {
          const key = `${status.attempt}:${status.next}`
          const out: KernelEvent[] = [{ type: 'status', state: 'retry' }]
          if (key !== lastRetry) {
            lastRetry = key
            out.push({
              type: 'retry',
              attempt: num(status.attempt),
              message: status.message ?? '',
              nextAt: num(status.next),
            })
          }
          return out
        }
        if (status.type === 'busy' || status.type === 'idle') {
          return [{ type: 'status', state: status.type }]
        }
        return []
      }
      case 'session.compacted':
        return p.sessionID === sessionId ? [{ type: 'compaction', summary: '' }] : []
      case 'session.idle':
        return p.sessionID === sessionId ? finish('completed') : []
      // CodeAgent：一次 prompt 的结束（比 session.idle 早到，idle 留着兜底）；
      // 中止时是 prompt.failed，markAborted 之后 finish 会记成 aborted
      case 'prompt.completed':
        return p.sessionID === sessionId ? finish('completed') : []
      case 'prompt.failed':
        return p.sessionID === sessionId ? finish('error', errorMessage(p.error)) : []
      // CodeAgent：模型网关调用重试
      case 'session.next.retried': {
        if (p.sessionID !== sessionId) return []
        const attempt = num(p.attempt)
        const nextAt = num(p.next) || Date.now()
        const key = `${attempt}:${nextAt}`
        if (key === lastRetry) return []
        lastRetry = key
        return [
          { type: 'status', state: 'retry' },
          { type: 'retry', attempt, message: errorMessage(p.error) ?? '', nextAt },
        ]
      }
      case 'session.error': {
        if (p.sessionID !== sessionId) return []
        const error = p.error as { name?: string } | undefined
        if (error?.name === 'MessageAbortedError') return finish('aborted')
        return finish('error', errorMessage(error))
      }
      default:
        return []
    }
  }

  return {
    map,
    permissions(pending) {
      return pending.flatMap((p) =>
        map({ type: 'permission.asked', properties: p as Record<string, unknown> }),
      )
    },
    backfill(messages, from = sessionId) {
      const out: KernelEvent[] = []
      for (const m of messages) {
        out.push(...map({ type: 'message.updated', properties: { sessionID: from, info: m.info } }))
        for (const part of m.parts) {
          out.push(...map({ type: 'message.part.updated', properties: { sessionID: from, part } }))
        }
      }
      return out
    },
    get subsessions() {
      return [...subsessions.keys()]
    },
    markAborted() {
      aborted = true
    },
    finish,
    get done() {
      return done
    },
  }
}
