import { randomUUID } from 'node:crypto'
import type {
  CreateSessionInput,
  KernelEvent,
  MessageView,
  PartView,
  PushEvents,
  SessionSummary,
  ToolCallRegistry,
} from '@kits/core'
import { type AgentKernel, agentPermissions, type KernelSession } from '@kits/kernel'
import type { KernelManager } from '../kernel/kernel-manager'
import { ConfigProblemsError } from '../kernel/kernel-manager'
import type { SessionStore } from './session-store'
import { TurnRecorder } from './thread'

// 会话编排（phase1-implementation 5.2 节）：建会话、发一轮、事件落库并推给界面、停止。
// 状态机：running → waiting（等确认 / 回答）→ running → done | error | aborted。

export interface SessionServiceDeps {
  store: SessionStore
  kernels: Pick<KernelManager, 'acquire' | 'release'>
  // 建内核会话时要 Agent 配置和 MCP 设置来算权限
  resolveAgent: (name: string) => Parameters<typeof agentPermissions>[0]
  loadMcp: () => Parameters<typeof agentPermissions>[2]
  registry: Pick<ToolCallRegistry, 'register'>
  push: <C extends keyof PushEvents>(channel: C, payload: PushEvents[C]) => void
  now?: () => number
  id?: () => string
  // 正文增量的落库和推送间隔
  flushMs?: number
}

interface Running {
  kernel: AgentKernel
  ks: KernelSession | undefined
  recorder: TurnRecorder
}

// 任务前 40 个字当标题，换行压成空格
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || '新会话'
}

export class SessionService {
  private running = new Map<string, Running>()
  private readonly now: () => number
  private readonly id: () => string
  private readonly flushMs: number

  constructor(private readonly deps: SessionServiceDeps) {
    this.now = deps.now ?? Date.now
    this.id = deps.id ?? randomUUID
    this.flushMs = deps.flushMs ?? 50
  }

  list(): SessionSummary[] {
    return this.deps.store.list()
  }

  get(id: string) {
    return this.deps.store.detail(id)
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async create(input: CreateSessionInput): Promise<SessionSummary> {
    const at = this.now()
    const session: SessionSummary = {
      id: this.id(),
      title: titleOf(input.text),
      agent: input.agent,
      kernel: input.kernel,
      workdir: input.workdir,
      model: input.model,
      permissionMode: input.permissionMode,
      status: 'running',
      turns: 0,
      createdAt: at,
      updatedAt: at,
      lastError: null,
    }
    this.deps.store.insertSession(session)
    this.deps.push('session.changed', session)
    this.startTurn(session, input.text)
    return session
  }

  async prompt(id: string, text: string): Promise<void> {
    const session = this.deps.store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    if (this.running.has(id)) throw new Error('这一轮还没结束')
    this.startTurn(session, text)
  }

  async abort(id: string): Promise<void> {
    const run = this.running.get(id)
    if (!run?.ks) return
    await run.kernel.abort(run.ks)
  }

  private update(id: string, patch: Parameters<SessionStore['updateSession']>[1]): void {
    const s = this.deps.store.updateSession(id, { ...patch, updatedAt: this.now() })
    if (s) this.deps.push('session.changed', s)
  }

  private saveMessage(m: MessageView): void {
    this.deps.store.saveMessage(m)
    this.deps.push('session.message', m)
  }

  private startTurn(session: SessionSummary, text: string): void {
    const turn = session.turns + 1
    const at = this.now()
    const user: MessageView = {
      id: this.id(),
      sessionId: session.id,
      role: 'user',
      turn,
      text,
      createdAt: at,
      completedAt: at,
      finishReason: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    }
    const assistant: MessageView = {
      ...user,
      id: this.id(),
      role: 'assistant',
      text: '',
      completedAt: null,
      createdAt: at + 1,
    }
    this.saveMessage(user)
    this.saveMessage(assistant)
    this.update(session.id, { turns: turn, status: 'running', lastError: null })
    const recorder = new TurnRecorder(session.id, assistant, this.now)
    void this.runTurn(session, text, recorder)
  }

  private async runTurn(
    session: SessionSummary,
    text: string,
    recorder: TurnRecorder,
  ): Promise<void> {
    const { store, kernels } = this.deps
    let kernel: AgentKernel
    try {
      kernel = await kernels.acquire(session.kernel)
    } catch (e) {
      const message =
        e instanceof ConfigProblemsError
          ? `配置不完整：${e.problems.map((p) => p.message).join('；')}`
          : `内核没有启动：${e instanceof Error ? e.message : String(e)}`
      this.apply(session.id, recorder, { type: 'done', reason: 'error', error: message })
      return
    }
    const run: Running = { kernel, ks: undefined, recorder }
    this.running.set(session.id, run)
    try {
      const existing = store.kernelSessionId(session.id)
      const ks: KernelSession = existing
        ? {
            id: existing,
            workdir: session.workdir,
            agent: session.agent,
            ...(session.model ? { model: session.model } : {}),
          }
        : await kernel.createSession({
            workdir: session.workdir,
            agent: session.agent,
            ...(session.model ? { model: session.model } : {}),
            title: session.title,
            permission: agentPermissions(
              this.deps.resolveAgent(session.agent),
              session.permissionMode,
              this.deps.loadMcp(),
            ),
          })
      if (!existing) store.updateSession(session.id, { kernelSessionId: ks.id })
      run.ks = ks
      for await (const event of kernel.prompt(ks, { text })) {
        // kits 工具的调用登记到关联表，工具服务收到调用时按参数对到这个会话
        if (event.type === 'tool-start' && event.name.startsWith('kits_')) {
          this.deps.registry.register(session.id, event.name.slice('kits_'.length), event.input)
        }
        this.apply(session.id, recorder, event)
      }
    } catch (e) {
      this.apply(session.id, recorder, {
        type: 'done',
        reason: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      this.flush()
      this.running.delete(session.id)
      kernels.release(session.kernel)
    }
  }

  // 正文增量攒一下再落库：模型一秒吐几十个 token，每个都写库、推送太浪费
  private pending = new Map<string, PartView>()
  private timer: ReturnType<typeof setTimeout> | undefined

  private flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const part of this.pending.values()) {
      this.deps.store.savePart(part)
      this.deps.push('session.part', part)
    }
    this.pending.clear()
  }

  private apply(sessionId: string, recorder: TurnRecorder, event: KernelEvent): void {
    if (event.type === 'status') {
      this.deps.push('session.activity', { sessionId, state: event.state, at: this.now() })
      return
    }
    const change = recorder.apply(event)
    const isDelta = event.type === 'text-delta' || event.type === 'reasoning-delta'
    if (isDelta) {
      for (const p of change.parts) this.pending.set(p.id, p)
      this.timer ??= setTimeout(() => this.flush(), this.flushMs)
    } else {
      this.flush()
      for (const p of change.parts) {
        this.deps.store.savePart(p)
        this.deps.push('session.part', p)
      }
    }
    if (change.message) this.saveMessage(change.message)
    if (change.status) {
      this.update(sessionId, {
        status: change.status,
        ...(change.error !== undefined ? { lastError: change.error } : {}),
      })
    }
  }
}
