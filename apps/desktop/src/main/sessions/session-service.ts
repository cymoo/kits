import { randomUUID } from 'node:crypto'
import type {
  AskUserInput,
  AskUserResult,
  CreateSessionInput,
  KitsToolContext,
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
import { type TurnChange, TurnRecorder } from './thread'

// 会话编排（phase1-implementation 5.2 节）：建会话、发一轮、事件落库并推给界面、停止。
// 状态机：running → waiting（等确认 / 回答）→ running → done | error | aborted。
// 运行中发的消息先排队，这一轮结束后合成一条发出去；停止会清掉队列。

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
  // 阻塞提问在等回答：questionId → 把回答交给 ask_user
  questions: Map<string, (result: AskUserResult) => void>
}

type PermissionReply = 'once' | 'always' | 'reject'

// 任务前 40 个字当标题，换行压成空格
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || '新会话'
}

export class SessionService {
  private running = new Map<string, Running>()
  private queues = new Map<string, string[]>()
  private readonly now: () => number
  private readonly id: () => string
  private readonly flushMs: number

  constructor(private readonly deps: SessionServiceDeps) {
    this.now = deps.now ?? Date.now
    this.id = deps.id ?? randomUUID
    this.flushMs = deps.flushMs ?? 50
  }

  list(): SessionSummary[] {
    return this.deps.store.list().map((s) => this.view(s))
  }

  get(id: string) {
    const detail = this.deps.store.detail(id)
    return detail ? { ...detail, session: this.view(detail.session) } : null
  }

  // 排队的消息不落库，推给界面时带上
  private view(s: SessionSummary): SessionSummary {
    const queued = this.queues.get(s.id)
    return queued?.length ? { ...s, queued: [...queued] } : s
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
    if (this.running.has(id)) {
      this.queues.set(id, [...(this.queues.get(id) ?? []), text])
      this.deps.push('session.changed', this.view(session))
      return
    }
    this.startTurn(session, text)
  }

  async abort(id: string): Promise<void> {
    if (this.queues.delete(id)) {
      const s = this.deps.store.session(id)
      if (s) this.deps.push('session.changed', s)
    }
    const run = this.running.get(id)
    if (!run) return
    // 阻塞提问不再等了；ask_user 先返回，内核才能收尾
    for (const resolve of run.questions.values()) resolve({ answered: false })
    run.questions.clear()
    if (run.ks) await run.kernel.abort(run.ks)
  }

  async respondPermission(input: {
    id: string
    requestId: string
    reply: PermissionReply
    message?: string
  }): Promise<void> {
    const run = this.running.get(input.id)
    if (!run?.ks) throw new Error('这一轮已经结束了')
    const message = input.message?.trim() || undefined
    await run.kernel.respondPermission(run.ks, input.requestId, input.reply, message)
    const change = run.recorder.replyPermission(input.requestId, input.reply, message)
    const part = change.parts[0]
    if (part?.payload.type === 'permission') {
      this.deps.store.logPermission({
        id: this.id(),
        sessionId: input.id,
        tool: part.payload.tool,
        input: part.payload.input,
        decision: input.reply,
        createdAt: this.now(),
      })
    }
    this.commit(input.id, change)
  }

  // ask_user 的处理函数（接到 KitsToolHost）。内核传来的会话 id 可能是 kits 的，也可能是内核自己的（Mock 内核）
  async askUser(input: AskUserInput, ctx: KitsToolContext): Promise<AskUserResult> {
    const found = this.findRun(ctx.sessionId)
    const fallback: AskUserResult = {
      answered: false,
      ...(input.assumption ? { assumption: input.assumption } : {}),
    }
    if (!found) return fallback
    const [sessionId, run] = found
    const questionId = this.id()
    const blocking = input.blocking
    const answer = blocking
      ? new Promise<AskUserResult>((resolve) => run.questions.set(questionId, resolve))
      : undefined
    this.commit(sessionId, run.recorder.question(questionId, input))
    return answer ?? fallback
  }

  async answerQuestion(input: { id: string; questionId: string; answer: string }): Promise<void> {
    const answer = input.answer.trim()
    if (!answer) throw new Error('回答不能为空')
    const run = this.running.get(input.id)
    const waiting = run?.questions.get(input.questionId)
    if (run && waiting) {
      run.questions.delete(input.questionId)
      this.commit(input.id, run.recorder.answer(input.questionId, answer))
      waiting({ answered: true, answer })
      return
    }
    // 不阻塞的提问：Agent 已经按假设往下做了，回答作为下一条消息发过去
    const part = this.deps.store.questionPart(input.id, input.questionId)
    if (!part || part.payload.type !== 'question') throw new Error('没有这个提问')
    if (part.payload.blocking && part.status !== 'pending') throw new Error('这个提问已经过期了')
    const answered = run?.recorder.answer(input.questionId, answer)
    if (answered?.parts.length) this.commit(input.id, answered)
    else {
      const updated: PartView = {
        ...part,
        payload: { ...part.payload, answer },
        status: 'answered',
        updatedAt: this.now(),
      }
      this.deps.store.savePart(updated)
      this.deps.push('session.part', updated)
    }
    await this.prompt(input.id, `关于“${part.payload.question}”：${answer}`)
  }

  private findRun(id: string | undefined): [string, Running] | undefined {
    if (!id) return undefined
    const direct = this.running.get(id)
    if (direct) return [id, direct]
    for (const entry of this.running) if (entry[1].ks?.id === id) return entry
    return undefined
  }

  private update(id: string, patch: Parameters<SessionStore['updateSession']>[1]): void {
    const s = this.deps.store.updateSession(id, { ...patch, updatedAt: this.now() })
    if (s) this.deps.push('session.changed', this.view(s))
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
      // 内核起不来，排队的消息发了也一样失败
      this.queues.delete(session.id)
      return
    }
    const run: Running = { kernel, ks: undefined, recorder, questions: new Map() }
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
      for (const resolve of run.questions.values()) resolve({ answered: false })
      this.running.delete(session.id)
      kernels.release(session.kernel)
      this.sendQueued(session.id)
    }
  }

  // 这一轮结束了，排队的消息合成一条接着发
  private sendQueued(id: string): void {
    const queued = this.queues.get(id)
    if (!queued?.length) return
    this.queues.delete(id)
    const session = this.deps.store.session(id)
    if (session) this.startTurn(session, queued.join('\n\n'))
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
    this.commit(sessionId, change, isDelta)
  }

  // recorder 的变化落库并推给界面；正文增量攒着批量写
  private commit(sessionId: string, change: TurnChange, isDelta = false): void {
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
