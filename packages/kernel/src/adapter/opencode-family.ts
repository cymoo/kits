import type { KernelEvent, PermissionReply, PermissionRule } from '@kits/core'
import { parseModelRef } from '@kits/core'
import { opencodeAgentName, toOpencodeRuleset } from '../generate/opencode-config'
import type {
  AgentKernel,
  CompactionResult,
  CreateSessionOptions,
  FileDiff,
  KernelConfig,
  KernelDialect,
  KernelExit,
  KernelMessage,
  KernelSession,
  SpawnedKernel,
  UserInput,
} from '../kernel'
import { createOpencodeEventMapper, type OpencodeEventMapper, type RawMessage } from './events'
import { readSseJson } from './sse'

// OpenCode 系适配器（phase1-implementation 4.2 节）：CodeAgent 和 OpenCode 共用，差异在方言里。
// - 事件流：GET /event?directory=<工作目录> 一条长连接按目录复用（OpenCode 按目录分实例），按 sessionID 分给各轮；
//   断开 1 s 后重连，重连后先拉 GET /session/{id}/message 补齐丢的 part。
// - 完成判定：session.idle 为准；每 5 s 轮询 GET /session/status 兜底；轮询也失败、SSE 又 60 s 没动静，判内核卡死。

export interface OpencodeFamilyOptions {
  pollIntervalMs?: number
  stallTimeoutMs?: number
  reconnectDelayMs?: number
  // 调完 abort 等内核自己发结束事件的时间，超时就直接结束这一轮
  abortGraceMs?: number
  // 准备阶段和补齐的请求超时（读历史消息、等事件流连上、提交这一轮）
  setupTimeoutMs?: number
}

type Listener = { onEvent(event: unknown): void; onReconnect(): void }

// 状态探测和 abort 的超时：内核连着但不回数据时，请求不能一直挂着
const STATUS_TIMEOUT_MS = 5_000
// 读历史消息、待处理权限、等事件流连上的超时
const RECOVER_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// 一个工作目录一条事件流，有订阅时连着，没订阅就断开
class KernelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

class EventHub {
  private listeners = new Set<Listener>()
  private controller: AbortController | undefined
  // 还在等第一条事件时被关掉（进程退出），让等着的订阅失败，不然这一轮一直挂着
  private failFirst: ((e: Error) => void) | undefined
  private connected: Promise<void> | undefined
  lastEventAt = Date.now()

  constructor(
    private readonly url: () => string,
    private readonly headers: () => Record<string, string>,
    private readonly reconnectDelayMs: number,
  ) {}

  async subscribe(listener: Listener): Promise<() => void> {
    this.listeners.add(listener)
    if (!this.controller) this.connected = this.run()
    try {
      await this.connected
    } catch (e) {
      // 连不上就把这次的订阅撤掉，不然残留的监听会让连接一直不关
      this.listeners.delete(listener)
      throw e
    }
    return () => this.remove(listener)
  }

  // 撤掉一个订阅；没人订阅了就断开连接（订阅还没连上就超时的也走这里）
  remove(listener: Listener): void {
    this.listeners.delete(listener)
    if (this.listeners.size === 0) {
      this.controller?.abort()
      this.controller = undefined
    }
  }

  // 第一次连上（收到第一条事件，一般是 server.connected）就返回，之后在后台读
  private run(): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    return new Promise((resolve, reject) => {
      let first = true
      this.failFirst = (e) => {
        if (!first) return
        first = false
        reject(e)
      }
      const loop = async () => {
        while (!controller.signal.aborted) {
          try {
            const res = await fetch(this.url(), {
              headers: { ...this.headers(), Accept: 'text/event-stream' },
              signal: controller.signal,
            })
            if (!res.ok || !res.body) throw new Error(`event stream returned ${res.status}`)
            let reconnected = !first
            for await (const event of readSseJson(res.body)) {
              this.lastEventAt = Date.now()
              if (first) {
                first = false
                resolve()
              }
              if (reconnected) {
                reconnected = false
                for (const l of this.listeners) l.onReconnect()
              }
              for (const l of this.listeners) l.onEvent(event)
            }
          } catch (e) {
            if (controller.signal.aborted) return
            if (first) {
              first = false
              if (this.controller === controller) this.controller = undefined
              reject(e)
              return
            }
          }
          if (controller.signal.aborted) return
          await new Promise((r) => setTimeout(r, this.reconnectDelayMs))
        }
      }
      void loop()
    })
  }

  close(): void {
    this.failFirst?.(new Error('内核事件流已关闭'))
    this.failFirst = undefined
    this.controller?.abort()
    this.controller = undefined
    this.listeners.clear()
  }
}

// 事件推进来、for await 取出去
class AsyncQueue<T> {
  private items: T[] = []
  private waiting: ((r: IteratorResult<T>) => void) | undefined
  private closed = false

  push(item: T): void {
    if (this.closed) return
    if (this.waiting) {
      const w = this.waiting
      this.waiting = undefined
      w({ value: item, done: false })
    } else this.items.push(item)
  }

  close(): void {
    this.closed = true
    if (this.waiting) {
      this.waiting({ value: undefined, done: true })
      this.waiting = undefined
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const item = this.items.shift()
      if (item !== undefined) {
        yield item
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<T>>((r) => {
        this.waiting = r
      })
      if (next.done) return
      yield next.value
    }
  }
}

// 窗口放不下系统提示词和工具定义时，内核压完马上又超，一直压下去。中间调过工具说明任务在往前走，不算
const MAX_IDLE_COMPACTIONS = 3
const CONTEXT_TOO_SMALL =
  '模型的上下文窗口太小，放不下系统提示词和工具定义，压缩也没用。到设置 → 内核与模型里核对这个模型的上下文。'

// 手动压缩：内核调一次模型把前面的对话压成摘要，长会话要一两分钟
const SUMMARIZE_TIMEOUT_MS = 5 * 60_000
function composeText(input: UserInput): { type: 'text'; text: string }[] {
  const parts = [{ type: 'text' as const, text: input.text }]
  for (const a of input.attachments ?? []) {
    parts.push({ type: 'text', text: `<attachment name="${a.name}">\n${a.text}\n</attachment>` })
  }
  return parts
}

export class OpencodeFamilyKernel implements AgentKernel {
  get capabilities() {
    return { subagents: true, revert: true, interject: this.dialect.interject }
  }
  private spawned: SpawnedKernel | undefined
  private hubs = new Map<string, EventHub>()
  private active = new Map<
    string,
    {
      mapper: OpencodeEventMapper
      queue: AsyncQueue<KernelEvent>
      cancelled: boolean
      // 停止时取消还在等的准备请求（提交这一轮的 prompt_async 等）
      controller: AbortController
    }
  >()
  private readonly poll: number
  private readonly stall: number
  private readonly reconnect: number
  private readonly abortGrace: number
  private readonly setupTimeout: number
  private exitListeners: ((exit: KernelExit) => void)[] = []

  constructor(
    private readonly dialect: KernelDialect,
    options: OpencodeFamilyOptions = {},
  ) {
    this.poll = options.pollIntervalMs ?? 5_000
    this.stall = options.stallTimeoutMs ?? 60_000
    this.reconnect = options.reconnectDelayMs ?? 1_000
    this.abortGrace = options.abortGraceMs ?? 5_000
    this.setupTimeout = options.setupTimeoutMs ?? RECOVER_TIMEOUT_MS
  }

  get id() {
    return this.dialect.id
  }

  async start(cfg: KernelConfig): Promise<void> {
    if (this.spawned) throw new Error('kernel already started')
    const spawned = await this.dialect.spawn(cfg)
    this.spawned = spawned
    spawned.onExit((exit) => this.handleExit(spawned, exit))
  }

  onExit(listener: (exit: KernelExit) => void): void {
    this.exitListeners.push(listener)
  }

  // 进程意外退出：正在跑的轮次以 done: error 结束，带退出码和输出尾部，再通知 KernelManager
  private handleExit(spawned: SpawnedKernel, exit: KernelExit): void {
    if (this.spawned !== spawned) return
    this.spawned = undefined
    const reason = exit.signal ? `信号 ${exit.signal}` : `退出码 ${exit.code}`
    const message = `内核进程退出了（${reason}）${exit.tail ? `\n${exit.tail}` : ''}`
    for (const run of this.active.values()) {
      for (const e of run.mapper.finish('error', message)) run.queue.push(e)
      run.queue.close()
    }
    this.active.clear()
    for (const hub of this.hubs.values()) hub.close()
    this.hubs.clear()
    for (const l of this.exitListeners) l(exit)
  }

  private get kernel(): SpawnedKernel {
    if (!this.spawned) throw new Error('kernel not started')
    return this.spawned
  }

  private url(route: string, workdir: string): string {
    return `${this.kernel.baseUrl}${this.dialect.apiPrefix}${route}?directory=${encodeURIComponent(workdir)}`
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    route: string,
    workdir: string,
    body?: unknown,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const signals = [
      ...(timeoutMs ? [AbortSignal.timeout(timeoutMs)] : []),
      ...(signal ? [signal] : []),
    ]
    const res = await fetch(this.url(route, workdir), {
      method,
      ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
      headers: {
        ...this.kernel.headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new KernelHttpError(
        `${method} ${route} returned ${res.status}: ${text.slice(0, 500)}`,
        res.status,
      )
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private hub(workdir: string): EventHub {
    let hub = this.hubs.get(workdir)
    if (!hub) {
      hub = new EventHub(
        () => this.url('/event', workdir),
        () => this.kernel.headers,
        this.reconnect,
      )
      this.hubs.set(workdir, hub)
    }
    return hub
  }

  async createSession(opts: CreateSessionOptions): Promise<KernelSession> {
    const created = await this.request<{ id: string }>('POST', '/session', opts.workdir, {
      ...(opts.title ? { title: opts.title } : {}),
      permission: toOpencodeRuleset(opts.permission),
    })
    return {
      id: created.id,
      workdir: opts.workdir,
      agent: opts.agent,
      ...(opts.model ? { model: opts.model } : {}),
    }
  }

  // 内核把这串规则追加到会话规则的末尾，后面的优先，所以发完整的新规则串就能盖掉旧的
  async setPermission(session: KernelSession, rules: PermissionRule[]): Promise<void> {
    await this.request('PATCH', `/session/${session.id}`, session.workdir, {
      permission: toOpencodeRuleset(rules),
    })
  }

  async *prompt(session: KernelSession, input: UserInput): AsyncIterable<KernelEvent> {
    if (this.active.has(session.id)) throw new Error(`session ${session.id} is already running`)
    const mapper = createOpencodeEventMapper(session.id)
    const queue = new AsyncQueue<KernelEvent>()
    const run = { mapper, queue, cancelled: false, controller: new AbortController() }
    this.active.set(session.id, run)
    const emit = (events: KernelEvent[]) => {
      for (const e of events) queue.push(e)
      if (mapper.done) queue.close()
    }
    const hub = this.hub(session.workdir)

    // 断线补齐：拉一次消息快照和待处理的权限请求，补上没发过的部分。
    // 补齐期间收到的实时事件先攒着、补完再按顺序映射；其中的正文增量直接丢掉，
    // 快照里已经有它们（之后还会有带整段正文的 message.part.updated 兜底），不然会和快照重复。
    // 这一轮开始前就有的消息按 id 排除，不靠时间窗口。
    const known = new Set<string>()
    let recovering: Promise<void> | undefined
    let buffered: unknown[] = []
    const recover = (): Promise<void> => {
      recovering ??= (async () => {
        try {
          // 两个请求各自成败：权限列表临时失败也不丢已经拿到的消息快照；都有超时，挂住不会让这一轮一直卡在补齐里
          const [messages, pending] = await Promise.allSettled([
            this.messages(session, this.setupTimeout),
            this.pendingPermissions(session),
          ])
          if (messages.status === 'fulfilled') {
            emit(
              mapper.backfill(
                (messages.value as RawMessage[]).filter((m) => !known.has(m.info.id ?? '')),
              ),
            )
          }
          // 子任务的步骤：主会话的快照补完才知道全部子会话
          const subs = mapper.subsessions
          const subMessages = await Promise.allSettled(
            subs.map((id) => this.messages({ ...session, id }, this.setupTimeout)),
          )
          subMessages.forEach((r, i) => {
            if (r.status === 'fulfilled') emit(mapper.backfill(r.value as RawMessage[], subs[i]))
          })
          if (pending.status === 'fulfilled') emit(mapper.permissions(pending.value))
        } finally {
          const events = buffered
          buffered = []
          recovering = undefined
          for (const event of events) emit(mapper.map(event))
        }
      })()
      return recovering
    }

    let timer: ReturnType<typeof setInterval> | undefined
    let unsubscribe: (() => void) | undefined
    try {
      try {
        for (const m of await this.messages(
          session,
          this.setupTimeout,
          run.controller.signal,
        ).catch(() => [])) {
          if (m.info.id) known.add(m.info.id)
        }
        const listener = {
          onEvent: (event: unknown) => {
            if (!recovering) emit(mapper.map(event))
            else if ((event as { type?: string }).type !== 'message.part.delta')
              buffered.push(event)
          },
          onReconnect: () => void recover(),
        }
        // 超时也要撤掉这次的订阅，不然残留的监听会让连接一直不关
        unsubscribe = await withTimeout(
          hub.subscribe(listener),
          this.setupTimeout,
          '连不上内核的事件流',
        ).catch((e: unknown) => {
          hub.remove(listener)
          throw e
        })
        // 准备期间用户已经点了停止：不再提交这一轮
        if (run.cancelled) {
          emit(mapper.finish('aborted'))
          yield* queue
          return
        }
        // 有超时，停止时也能取消：内核收了请求却一直不回时，这一轮不会卡在这里
        await this.submit(session, input, run.controller.signal)
      } catch (e) {
        // 连不上内核或发消息失败：照样以 done 结束这一轮，界面显示出错卡片。
        // 进程退出时 handleExit 可能已经把 done 放进队列，所以统一从队列里取
        emit(mapper.finish('error', e instanceof Error ? e.message : String(e)))
        yield* queue
        return
      }

      let sawBusy = false
      let idlePolls = 0
      let polling = false
      let lastStatusAt = Date.now()
      const checkStall = () => {
        if (Date.now() - Math.max(hub.lastEventAt, lastStatusAt) > this.stall) {
          emit(mapper.finish('error', '内核没有响应：事件流和状态接口都没有回应'))
        }
      }
      timer = setInterval(() => {
        // 上一次探测还没回来就不再发，只看是不是卡死了
        if (polling) return checkStall()
        polling = true
        this.request<Record<string, { type?: string }>>(
          'GET',
          '/session/status',
          session.workdir,
          undefined,
          STATUS_TIMEOUT_MS,
        )
          .then((status) => {
            lastStatusAt = Date.now()
            const type = status?.[session.id]?.type
            if (type === 'busy' || type === 'retry') {
              sawBusy = true
              idlePolls = 0
              return
            }
            // idle 的会话不一定出现在列表里；session.idle 可能丢在断线里，收尾前先补齐
            idlePolls += 1
            if (sawBusy || idlePolls >= 2) {
              void recover().then(() => emit(mapper.finish('completed')))
            }
          })
          .catch(checkStall)
          .finally(() => {
            polling = false
          })
      }, this.poll)
      timer.unref?.()

      let idleCompactions = 0
      for await (const event of queue) {
        if (event.type === 'status' && event.state !== 'idle') sawBusy = true
        if (event.type === 'tool-start') idleCompactions = 0
        yield event
        if (event.type === 'compaction' && ++idleCompactions >= MAX_IDLE_COMPACTIONS) {
          emit(mapper.finish('error', CONTEXT_TOO_SMALL))
          void this.request(
            'POST',
            `/session/${session.id}/abort`,
            session.workdir,
            undefined,
            STATUS_TIMEOUT_MS,
          ).catch(() => {})
        }
      }
    } finally {
      if (timer) clearInterval(timer)
      unsubscribe?.()
      this.active.delete(session.id)
    }
  }

  private submit(session: KernelSession, input: UserInput, signal?: AbortSignal): Promise<unknown> {
    const model = session.model ? parseModelRef(session.model) : undefined
    return this.request(
      'POST',
      `/session/${session.id}/prompt_async`,
      session.workdir,
      {
        agent: opencodeAgentName(session.agent),
        ...(model ? { model: { providerID: model.gateway, modelID: model.model } } : {}),
        ...(input.system ? { system: input.system } : {}),
        parts: composeText(input),
      },
      this.setupTimeout,
      signal,
    )
  }

  async interject(session: KernelSession, input: UserInput): Promise<boolean> {
    const run = this.active.get(session.id)
    if (!run || !this.dialect.interject) return false
    await this.submit(session, input, run.controller.signal)
    return true
  }

  // 还在等回复的权限请求（GET /permission，整个实例的）。映射器按会话过滤：它知道这一轮有哪些子会话
  private async pendingPermissions(session: KernelSession): Promise<unknown[]> {
    const list = await this.request<unknown[]>(
      'GET',
      this.dialect.permissionListPath,
      session.workdir,
      undefined,
      this.setupTimeout,
    )
    return list ?? []
  }

  async respondPermission(
    session: KernelSession,
    requestId: string,
    reply: PermissionReply,
    message?: string,
  ): Promise<boolean> {
    try {
      await this.request(
        'POST',
        this.dialect.permissionReplyPath(requestId, session.id),
        session.workdir,
        { reply, ...(message ? { message } : {}) },
      )
      return true
    } catch (e) {
      // 内核已经处理掉了这个请求：工具调用被打断时它会直接移除，不发 permission.replied
      if (e instanceof KernelHttpError && e.status === 404) return false
      throw e
    }
  }

  async abort(session: KernelSession): Promise<void> {
    const run = this.active.get(session.id)
    if (run) {
      run.cancelled = true
      run.mapper.markAborted()
      run.controller.abort()
      // 先排好兜底：abort 请求挂住或失败，这一轮也会在 abortGrace 后结束
      setTimeout(() => {
        for (const e of run.mapper.finish('aborted')) run.queue.push(e)
        run.queue.close()
      }, this.abortGrace).unref?.()
    }
    await this.request(
      'POST',
      `/session/${session.id}/abort`,
      session.workdir,
      undefined,
      STATUS_TIMEOUT_MS,
    )
  }

  // 1.19.5 的 GET /session/{id}/diff 不带 messageID 时返回空；每一轮的改动记在那一轮用户消息的 summary.diffs 上，
  // 这里按轮收集（契约测试实测），改动面板按 messageId 分组
  async diff(session: KernelSession): Promise<FileDiff[]> {
    const messages = await this.messages(session)
    let turn = 0
    return messages.flatMap((m) => {
      const info = m.info as {
        id?: string
        role?: string
        summary?: {
          diffs?: {
            file?: string
            patch?: string
            additions?: number
            deletions?: number
            status?: string
          }[]
        }
      }
      if (info.role !== 'user') return []
      turn += 1
      const at = turn
      return (info.summary?.diffs ?? []).map((d) => ({
        path: d.file ?? '',
        status: d.status === 'added' || d.status === 'deleted' ? d.status : ('modified' as const),
        additions: d.additions ?? 0,
        deletions: d.deletions ?? 0,
        patch: d.patch ?? '',
        ...(info.id ? { messageId: info.id } : {}),
        turn: at,
      }))
    })
  }

  async summarize(session: KernelSession): Promise<CompactionResult> {
    const ref = session.model ? parseModelRef(session.model) : undefined
    let model = ref ? { providerID: ref.gateway, modelID: ref.model } : undefined
    if (!model) {
      // 用默认模型建的会话：取最近一条回复实际用的模型
      const info = (await this.messages(session))
        .map((m) => m.info as { role?: string; providerID?: string; modelID?: string })
        .filter((i) => i.role === 'assistant' && i.providerID && i.modelID)
        .at(-1)
      if (info?.providerID && info.modelID)
        model = { providerID: info.providerID, modelID: info.modelID }
    }
    if (!model) throw new Error('这个会话还没有回复过，不知道用哪个模型压缩')
    // 压缩要调一次模型，等它做完才返回；给足时间
    await this.request(
      'POST',
      `/session/${session.id}/summarize`,
      session.workdir,
      model,
      SUMMARIZE_TIMEOUT_MS,
    )
    // 摘要是一条 summary: true 的助手消息，正文在它的 text part 里
    const last = (await this.messages(session))
      .filter((m) => {
        const info = m.info as { role?: string; summary?: boolean }
        return info.role === 'assistant' && info.summary === true
      })
      .at(-1)
    const summary = (last?.parts ?? [])
      .flatMap((p) => {
        const part = p as { type?: string; text?: string; synthetic?: boolean }
        return part.type === 'text' && part.text && !part.synthetic ? [part.text] : []
      })
      .join('\n\n')
      .trim()
    const tokens = (last?.info as { tokens?: { output?: number } } | undefined)?.tokens?.output ?? 0
    return { summary, tokens }
  }

  async messages(
    session: KernelSession,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<KernelMessage[]> {
    return (
      (await this.request<KernelMessage[]>(
        'GET',
        `/session/${session.id}/message`,
        session.workdir,
        undefined,
        timeoutMs,
        signal,
      )) ?? []
    )
  }

  async revert(session: KernelSession, messageId: string): Promise<void> {
    await this.request('POST', `/session/${session.id}/revert`, session.workdir, {
      messageID: messageId,
    })
  }

  async dispose(): Promise<void> {
    for (const hub of this.hubs.values()) hub.close()
    this.hubs.clear()
    for (const run of this.active.values()) run.queue.close()
    this.active.clear()
    await this.spawned?.close()
    this.spawned = undefined
  }
}
