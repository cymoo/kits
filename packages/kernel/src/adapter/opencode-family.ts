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

// 一个工作目录一条事件流，有订阅时连着，没订阅就断开
class EventHub {
  private listeners = new Set<Listener>()
  private controller: AbortController | undefined
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
    await this.connected
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
  ): Promise<T> {
    const res = await fetch(this.url(route, workdir), {
      method,
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
    // 消息时间戳由内核打，留一点余量防两边时钟抖动
    const since = Date.now() - 1_000
    const hub = this.hub(session.workdir)
    let timer: ReturnType<typeof setInterval> | undefined
    let unsubscribe: (() => void) | undefined
    try {
      try {
        unsubscribe = await hub.subscribe({
          onEvent: (event) => emit(mapper.map(event)),
          onReconnect: () => {
            this.messages(session)
              .then((messages) => emit(mapper.backfill(messages as RawMessage[], since)))
              .catch(() => {
                // 补齐失败不影响后续事件
              })
          },
        })
        const model = session.model ? parseModelRef(session.model) : undefined
        await this.request('POST', `/session/${session.id}/prompt_async`, session.workdir, {
          agent: opencodeAgentName(session.agent),
          ...(model ? { model: { providerID: model.gateway, modelID: model.model } } : {}),
          parts: composeText(input),
        })
      } catch (e) {
        // 连不上内核或发消息失败：照样以 done 结束这一轮，界面显示出错卡片
        yield* mapper.finish('error', e instanceof Error ? e.message : String(e))
        return
      }

      let sawBusy = false
      let idlePolls = 0
      timer = setInterval(() => {
        this.request<Record<string, { type?: string }>>('GET', '/session/status', session.workdir)
          .then((status) => {
            const type = status?.[session.id]?.type
            if (type === 'busy' || type === 'retry') {
              sawBusy = true
              idlePolls = 0
              return
            }
            // idle 的会话不一定出现在列表里
            idlePolls += 1
            if (sawBusy || idlePolls >= 2) emit(mapper.finish('completed'))
          })
          .catch(() => {
            if (Date.now() - hub.lastEventAt > this.stall) {
              emit(mapper.finish('error', '内核没有响应：事件流和状态接口都没有回应'))
            }
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
    const model = session.model ? parseModelRef(session.model) : undefined
    if (!model) throw new Error('summarize needs the session model')
    await this.request('POST', `/session/${session.id}/summarize`, session.workdir, {
      providerID: model.gateway,
      modelID: model.model,
    })
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
