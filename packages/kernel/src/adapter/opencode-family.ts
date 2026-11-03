import type { KernelEvent, PermissionReply } from '@kits/core'
import { parseModelRef } from '@kits/core'
import { opencodeAgentName, toOpencodeRuleset } from '../generate/opencode-config'
import type {
  AgentKernel,
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
}

type Listener = { onEvent(event: unknown): void; onReconnect(): void }

// 状态探测的超时：内核连着但不回数据时，探测不能一直挂着
const STATUS_TIMEOUT_MS = 5_000

// 一个工作目录一条事件流，有订阅时连着，没订阅就断开
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
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.controller?.abort()
        this.controller = undefined
      }
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

function composeText(input: UserInput): { type: 'text'; text: string }[] {
  const parts = [{ type: 'text' as const, text: input.text }]
  for (const a of input.attachments ?? []) {
    parts.push({ type: 'text', text: `<attachment name="${a.name}">\n${a.text}\n</attachment>` })
  }
  return parts
}

export class OpencodeFamilyKernel implements AgentKernel {
  readonly capabilities = { subagents: true, revert: true }
  private spawned: SpawnedKernel | undefined
  private hubs = new Map<string, EventHub>()
  private active = new Map<
    string,
    { mapper: OpencodeEventMapper; queue: AsyncQueue<KernelEvent> }
  >()
  private readonly poll: number
  private readonly stall: number
  private readonly reconnect: number
  private readonly abortGrace: number
  private exitListeners: ((exit: KernelExit) => void)[] = []

  constructor(
    private readonly dialect: KernelDialect,
    options: OpencodeFamilyOptions = {},
  ) {
    this.poll = options.pollIntervalMs ?? 5_000
    this.stall = options.stallTimeoutMs ?? 60_000
    this.reconnect = options.reconnectDelayMs ?? 1_000
    this.abortGrace = options.abortGraceMs ?? 5_000
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
    method: 'GET' | 'POST',
    route: string,
    workdir: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const res = await fetch(this.url(route, workdir), {
      method,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: {
        ...this.kernel.headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${method} ${route} returned ${res.status}: ${text.slice(0, 500)}`)
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

  async *prompt(session: KernelSession, input: UserInput): AsyncIterable<KernelEvent> {
    if (this.active.has(session.id)) throw new Error(`session ${session.id} is already running`)
    const mapper = createOpencodeEventMapper(session.id)
    const queue = new AsyncQueue<KernelEvent>()
    this.active.set(session.id, { mapper, queue })
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
          const [messages, pending] = await Promise.all([
            this.messages(session),
            this.pendingPermissions(session),
          ])
          emit(
            mapper.backfill((messages as RawMessage[]).filter((m) => !known.has(m.info.id ?? ''))),
          )
          emit(mapper.permissions(pending))
        } catch {
          // 补齐失败不影响后续事件
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
        for (const m of await this.messages(session).catch(() => [])) {
          if (m.info.id) known.add(m.info.id)
        }
        unsubscribe = await hub.subscribe({
          onEvent: (event) => {
            if (!recovering) emit(mapper.map(event))
            else if ((event as { type?: string }).type !== 'message.part.delta')
              buffered.push(event)
          },
          onReconnect: () => void recover(),
        })
        const model = session.model ? parseModelRef(session.model) : undefined
        await this.request('POST', `/session/${session.id}/prompt_async`, session.workdir, {
          agent: opencodeAgentName(session.agent),
          ...(model ? { model: { providerID: model.gateway, modelID: model.model } } : {}),
          parts: composeText(input),
        })
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

      for await (const event of queue) {
        if (event.type === 'status' && event.state !== 'idle') sawBusy = true
        yield event
      }
    } finally {
      if (timer) clearInterval(timer)
      unsubscribe?.()
      this.active.delete(session.id)
    }
  }

  // 还在等回复的权限请求（GET /permission，整个实例的），按会话过滤
  private async pendingPermissions(session: KernelSession): Promise<unknown[]> {
    const list = await this.request<{ sessionID?: string }[]>(
      'GET',
      this.dialect.permissionListPath,
      session.workdir,
    )
    return (list ?? []).filter((p) => p.sessionID === session.id)
  }

  async respondPermission(
    session: KernelSession,
    requestId: string,
    reply: PermissionReply,
    message?: string,
  ): Promise<void> {
    await this.request(
      'POST',
      this.dialect.permissionReplyPath(requestId, session.id),
      session.workdir,
      { reply, ...(message ? { message } : {}) },
    )
  }

  async abort(session: KernelSession): Promise<void> {
    const run = this.active.get(session.id)
    run?.mapper.markAborted()
    await this.request('POST', `/session/${session.id}/abort`, session.workdir)
    if (run) {
      setTimeout(() => {
        for (const e of run.mapper.finish('aborted')) run.queue.push(e)
        run.queue.close()
      }, this.abortGrace).unref?.()
    }
  }

  async diff(session: KernelSession): Promise<FileDiff[]> {
    const raw = await this.request<
      { file?: string; patch?: string; additions?: number; deletions?: number; status?: string }[]
    >('GET', `/session/${session.id}/diff`, session.workdir)
    return (raw ?? []).map((d) => ({
      path: d.file ?? '',
      status: d.status === 'added' || d.status === 'deleted' ? d.status : 'modified',
      additions: d.additions ?? 0,
      deletions: d.deletions ?? 0,
      patch: d.patch ?? '',
    }))
  }

  async summarize(session: KernelSession): Promise<void> {
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
    await this.request('POST', `/session/${session.id}/summarize`, session.workdir, model)
  }

  async messages(session: KernelSession): Promise<KernelMessage[]> {
    return (
      (await this.request<KernelMessage[]>(
        'GET',
        `/session/${session.id}/message`,
        session.workdir,
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
