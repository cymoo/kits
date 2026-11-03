import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  AskUserInput,
  AskUserResult,
  AttachmentInput,
  CreateSessionInput,
  FileDiffView,
  KernelEvent,
  KitsToolContext,
  MessageView,
  OutputView,
  PartView,
  PushEvents,
  SessionSummary,
  ToolCallRegistry,
} from '@kits/core'
import { skillPrompt } from '@kits/core'
import { type AgentKernel, agentPermissions, type KernelSession, skillDenies } from '@kits/kernel'
import { extractText } from '../attachments/extract'
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
  // 一轮结束后隔多久去内核取改动：内核是异步算的，取几次，变了才落库推送
  diffDelays?: number[]
  // 导出的产出写到这里（{userData}/exports）
  exportsDir: string
  // 附件原文件和转出来的文字放这里（{userData}/attachments），每个会话一个子目录
  attachmentsDir: string
  // settings.json 里关掉的技能
  disabledSkills?: () => string[]
  // 这个工作目录下能用的技能名（三级合并后启用的），`/技能名` 开头的消息据此改写
  enabledSkills?: (workdir: string) => string[]
  // 附件转文本，测试里可以换掉
  extractText?: (name: string, mime: string, data: Uint8Array) => Promise<string>
  // 取改动、补轮次号读内核的截止时间：请求挂住也要收尾、释放内核
  readTimeoutMs?: number
}

// 给读内核的请求加截止时间：超时就当失败，后面照常收尾
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`读内核超过 ${ms} ms 没有返回`)), ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

// 单个附件的大小上限
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

// 存好、转好文字的附件，等这一轮的用户消息建好再落库
interface StagedAttachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
  textPath: string
  text: string
}

// 运行中发的一条消息，排队到这一轮结束
interface Queued {
  text: string
  attachments: StagedAttachment[]
}

// 导出文件名：日期-标题[-第 N 轮]，去掉文件名里不能用的字符
export function exportName(title: string, turn: number, turns: number, at: number): string {
  const d = new Date(at)
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const slug =
    title
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || '产出'
  return `${date}-${slug}${turns > 1 ? `-第${turn}轮` : ''}`
}

// 一轮从 startTurn 起就登记：内核冷启动期间也能拦住重复的 prompt、接住停止
interface Running {
  kernel: AgentKernel | undefined
  ks: KernelSession | undefined
  recorder: TurnRecorder
  // 阻塞提问在等回答：questionId → 把回答交给 ask_user
  questions: Map<string, (result: AskUserResult) => void>
  // 内核还没起来、内核会话还没建好时点了停止
  cancelled: boolean
  // 这一轮的用户消息和轮次（改动对回本地轮次用）
  userMessageId: string
  turn: number
  // 这一轮带的附件（已经转成文字），随消息发给内核
  attachments: { name: string; text: string }[]
}

type PermissionReply = 'once' | 'always' | 'reject'

// 任务前 40 个字当标题，换行压成空格
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || '新会话'
}

export class SessionService {
  private running = new Map<string, Running>()
  private queues = new Map<string, Queued[]>()
  // 建会话时选的“这次不用的 MCP 服务”，第一轮在内核里建会话时用
  private mcpOff = new Map<string, string[]>()
  // 每次停止加一：转附件期间停止的追问据此作废
  private abortGen = new Map<string, number>()
  private readonly now: () => number
  private readonly id: () => string
  private readonly flushMs: number
  private readonly diffDelays: number[]
  private readonly readTimeoutMs: number

  constructor(private readonly deps: SessionServiceDeps) {
    this.now = deps.now ?? Date.now
    this.id = deps.id ?? randomUUID
    this.flushMs = deps.flushMs ?? 50
    this.diffDelays = deps.diffDelays ?? [300, 1_500, 4_000]
    this.readTimeoutMs = deps.readTimeoutMs ?? 10_000
  }

  list(): SessionSummary[] {
    return this.deps.store.list().map((s) => this.view(s))
  }

  diffs(id: string): FileDiffView[] {
    return this.deps.store.diffs(id)
  }

  outputs(id: string): OutputView[] {
    return this.deps.store.outputs(id)
  }

  // 产出面板的自动保存；null 是还原为 AI 原稿
  saveOutput(input: { id: string; edited: unknown | null }): OutputView {
    const current = this.deps.store.output(input.id)
    if (!current) throw new Error('没有这份产出')
    // 改回和原稿一样就当没改
    const same = JSON.stringify(input.edited) === JSON.stringify(current.aiDraft)
    const saved = this.deps.store.saveEdited(input.id, same ? null : input.edited, this.now())
    if (!saved) throw new Error('没有这份产出')
    this.deps.push('session.output', saved)
    return saved
  }

  exportOutput(input: { id: string; format: 'markdown' | 'json' }): { path: string } {
    const output = this.deps.store.output(input.id)
    if (!output) throw new Error('没有这份产出')
    const session = this.deps.store.session(output.sessionId)
    const content = output.edited ?? output.aiDraft
    const at = this.now()
    const text =
      input.format === 'markdown'
        ? typeof content === 'string'
          ? content
          : `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\`\n`
        : JSON.stringify(content, null, 2)
    mkdirSync(this.deps.exportsDir, { recursive: true })
    const base = exportName(session?.title ?? '', output.turn, session?.turns ?? 1, at)
    const ext = input.format === 'markdown' ? 'md' : 'json'
    // 同一天同名的任务不互相覆盖：重名就加序号
    let file = path.join(this.deps.exportsDir, `${base}.${ext}`)
    for (let n = 2; existsSync(file); n++)
      file = path.join(this.deps.exportsDir, `${base}-${n}.${ext}`)
    writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`)
    const marked = this.deps.store.markExported(input.id, input.format, at)
    if (marked) this.deps.push('session.output', marked)
    return { path: file }
  }

  // kits 工具服务：会话的 Agent 的输出格式（有它才提供 submit_output）
  outputSchema(ctx: KitsToolContext): Record<string, unknown> | undefined {
    const found = this.findRun(ctx.sessionId)
    const session = found ? this.deps.store.session(found[0]) : undefined
    return session ? this.deps.resolveAgent(session.agent)?.outputSchema : undefined
  }

  // submit_output 校验通过后：存成这一轮的结构化产出
  async onOutput(output: unknown, ctx: KitsToolContext): Promise<void> {
    const found = this.findRun(ctx.sessionId)
    if (!found) return
    const [sessionId, run] = found
    const saved = this.deps.store.saveDraft({
      sessionId,
      turn: run.turn,
      kind: 'structured',
      aiDraft: output,
    })
    this.deps.push('session.output', saved)
  }

  get(id: string) {
    const detail = this.deps.store.detail(id)
    return detail ? { ...detail, session: this.view(detail.session) } : null
  }

  // 排队的消息不落库，推给界面时带上
  private view(s: SessionSummary): SessionSummary {
    const queued = this.queues.get(s.id)
    return queued?.length ? { ...s, queued: queued.map((q) => q.text) } : s
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async create(input: CreateSessionInput): Promise<SessionSummary> {
    const id = this.id()
    // 先存附件、转文字：读不了的文件直接报错，会话不建
    const staged = await this.stage(id, input.attachments ?? [])
    const at = this.now()
    const session: SessionSummary = {
      id,
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
    if (input.mcpOff?.length) this.mcpOff.set(id, input.mcpOff)
    this.deps.push('session.changed', session)
    this.startTurn(session, input.text, staged)
    return session
  }

  async prompt(id: string, text: string, attachments: AttachmentInput[] = []): Promise<void> {
    if (!this.deps.store.session(id)) throw new Error(`没有这个会话：${id}`)
    // 转附件期间点了停止：这条也作废（停止要连还没进队列的一起停）
    const gen = this.abortGen.get(id) ?? 0
    const staged = await this.stage(id, attachments)
    if ((this.abortGen.get(id) ?? 0) !== gen) {
      this.unstage(staged)
      return
    }
    // 转附件要时间，回来时会话的状态可能变了，重新读
    const session = this.deps.store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    if (this.running.has(id)) {
      this.queues.set(id, [...(this.queues.get(id) ?? []), { text, attachments: staged }])
      this.deps.push('session.changed', this.view(session))
      return
    }
    this.startTurn(session, text, staged)
  }

  // 附件存到 {attachmentsDir}/<会话>/，原文件和转出来的文字各一份
  private async stage(sessionId: string, inputs: AttachmentInput[]): Promise<StagedAttachment[]> {
    if (!inputs.length) return []
    const extract = this.deps.extractText ?? extractText
    const dir = path.join(this.deps.attachmentsDir, sessionId)
    const staged: StagedAttachment[] = []
    // 这一批写出去的文件：有一个失败就整批清掉，不在磁盘上留没有记录的副本
    const written: string[] = []
    try {
      for (const a of inputs) {
        if (a.data.byteLength > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${a.name} 超过 20 MB，先拆小一点再发`)
        }
        const text = await extract(a.name, a.mime, a.data)
        const id = this.id()
        const safe = a.name.replace(/[\\/:*?"<>|]+/g, '_')
        const file = path.join(dir, `${id}-${safe}`)
        mkdirSync(dir, { recursive: true })
        written.push(file)
        writeFileSync(file, a.data)
        written.push(`${file}.txt`)
        writeFileSync(`${file}.txt`, text)
        staged.push({
          id,
          name: a.name,
          mime: a.mime,
          size: a.data.byteLength,
          path: file,
          textPath: `${file}.txt`,
          text,
        })
      }
    } catch (e) {
      for (const f of written) rmSync(f, { force: true })
      throw e
    }
    return staged
  }

  // 作废的附件（停止了、没发出去）删掉
  private unstage(staged: StagedAttachment[]): void {
    for (const a of staged) {
      rmSync(a.path, { force: true })
      rmSync(a.textPath, { force: true })
    }
  }

  async abort(id: string): Promise<void> {
    this.abortGen.set(id, (this.abortGen.get(id) ?? 0) + 1)
    // 排队的消息作废，它们带的附件也删掉
    for (const q of this.queues.get(id) ?? []) this.unstage(q.attachments)
    if (this.queues.delete(id)) {
      const s = this.deps.store.session(id)
      if (s) this.deps.push('session.changed', s)
    }
    const run = this.running.get(id)
    if (!run) return
    run.cancelled = true
    // 阻塞提问不再等了；ask_user 先返回，内核才能收尾
    for (const resolve of run.questions.values()) resolve({ answered: false })
    run.questions.clear()
    // 还在启动的轮次在启动完后看到 cancelled 自己结束
    if (run.kernel && run.ks) await run.kernel.abort(run.ks)
  }

  async respondPermission(input: {
    id: string
    requestId: string
    reply: PermissionReply
    message?: string
  }): Promise<void> {
    const run = this.running.get(input.id)
    if (!run?.kernel || !run.ks) throw new Error('这一轮已经结束了')
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
    // 等内核回复期间这一轮可能已经结束、甚至排队的下一轮已经开始：决定照存，会话状态不再由它改
    const current = this.running.get(input.id) === run && run.recorder.view.completedAt === null
    this.commit(input.id, current ? change : { parts: change.parts })
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
    if (part?.payload.type !== 'question') throw new Error('没有这个提问')
    // 阻塞的提问只能在 Agent 还在等的时候回答（上面那个分支）；停止后卡片可能还没来得及变成过期
    if (part.payload.blocking) throw new Error('这个提问已经过期了')
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

  private startTurn(
    session: SessionSummary,
    text: string,
    attachments: StagedAttachment[] = [],
  ): void {
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
      contextTokens: 0,
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
    for (const a of attachments) {
      this.deps.store.saveAttachment({
        id: a.id,
        sessionId: session.id,
        messageId: user.id,
        name: a.name,
        mime: a.mime,
        size: a.size,
        path: a.path,
        textPath: a.textPath,
      })
    }
    if (attachments.length) {
      this.deps.push('session.attachments', {
        sessionId: session.id,
        attachments: this.deps.store.attachments(session.id),
      })
    }
    this.saveMessage(assistant)
    this.update(session.id, { turns: turn, status: 'running', lastError: null })
    const recorder = new TurnRecorder(session.id, assistant, this.now)
    const run: Running = {
      kernel: undefined,
      ks: undefined,
      recorder,
      questions: new Map(),
      cancelled: false,
      userMessageId: user.id,
      turn,
      attachments: attachments.map((a) => ({ name: a.name, text: a.text })),
    }
    this.running.set(session.id, run)
    void this.runTurn(session, text, run)
  }

  private async runTurn(session: SessionSummary, text: string, run: Running): Promise<void> {
    const { store, kernels } = this.deps
    const { recorder } = run
    let kernel: AgentKernel
    try {
      kernel = await kernels.acquire(session.kernel)
    } catch (e) {
      const message =
        e instanceof ConfigProblemsError
          ? `配置不完整：${e.problems.map((p) => p.message).join('；')}`
          : `内核没有启动：${e instanceof Error ? e.message : String(e)}`
      // 内核起不来，排队的消息发了也一样失败；先清队列，推给界面的终态里就不带排队
      this.queues.delete(session.id)
      this.apply(
        session.id,
        recorder,
        run.cancelled
          ? { type: 'done', reason: 'aborted' }
          : { type: 'done', reason: 'error', error: message },
      )
      this.running.delete(session.id)
      return
    }
    run.kernel = kernel
    try {
      if (run.cancelled) {
        this.apply(session.id, recorder, { type: 'done', reason: 'aborted' })
        return
      }
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
            permission: [
              ...agentPermissions(
                this.deps.resolveAgent(session.agent),
                session.permissionMode,
                this.deps.loadMcp(),
              ),
              // 关掉的技能和内核自带的技能：会话规则排在全局后面，这里要再拒绝一遍
              ...skillDenies(this.deps.disabledSkills?.() ?? []),
              // 输入框里关掉的平台：这个会话里它的工具一律不能用（排在最后，最后命中的生效）
              ...(this.mcpOff.get(session.id) ?? []).map((server) => ({
                tool: `${server}_*`,
                pattern: '*',
                level: 'deny' as const,
              })),
            ],
          })
      if (!existing) store.updateSession(session.id, { kernelSessionId: ks.id })
      run.ks = ks
      // 建内核会话期间点了停止：不再发这一轮
      if (run.cancelled) {
        this.apply(session.id, recorder, { type: 'done', reason: 'aborted' })
        return
      }
      let submitted = false
      // `/技能名 …`：发给内核时明确让 Agent 先加载这个技能；界面上的用户消息照原样
      const sent = skillPrompt(text, this.deps.enabledSkills?.(session.workdir) ?? [])
      for await (const event of kernel.prompt(ks, { text: sent, attachments: run.attachments })) {
        // 内核有了动静（不是准备阶段就结束）才算这条消息真的进了内核：这时记下它是内核里第几条用户消息
        if (!submitted && event.type !== 'done') {
          submitted = true
          await this.assignKernelTurn(session, run, kernel, ks)
        }
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
      // 取改动要用这个内核实例：取完再释放，期间排着的重启会等它
      if (run.ks) {
        void this.refreshDiffs(session.id, kernel, run.ks, run.turn).finally(() =>
          kernels.release(session.kernel),
        )
      } else {
        kernels.release(session.kernel)
      }
      this.sendQueued(session.id)
    }
  }

  // 这一轮的用户消息是内核会话里的第几条。升级前建的会话旧消息没有记录：第一次时按内核里已有的用户消息数补上
  private async assignKernelTurn(
    session: SessionSummary,
    run: Running,
    kernel: AgentKernel,
    ks: KernelSession,
  ): Promise<void> {
    const { store } = this.deps
    let at: number | undefined
    if (run.turn > 1 && store.kernelTurns(session.id).size === 0) {
      const history = await withDeadline(kernel.messages(ks), this.readTimeoutMs).catch(() => [])
      const users = history.filter((m) => m.info.role === 'user').length
      if (users > 0) at = users
    }
    store.assignKernelTurn(session.id, run.userMessageId, at)
  }

  // 内核在一轮结束后才把这一轮的改动算出来（OpenCode 写在用户消息的 summary 上），隔几次去取。
  // 内核按自己的用户消息编号，用发出时记下的对应关系换回本地轮次；内核没给编号（Mock）就算在刚结束的这一轮
  private diffGen = new Map<string, number>()

  private async refreshDiffs(
    id: string,
    kernel: AgentKernel,
    ks: KernelSession,
    turn: number,
  ): Promise<void> {
    // 每个会话只认最新一次刷新：上一轮的刷新还在路上、晚回来的旧结果不覆盖新的
    const gen = (this.diffGen.get(id) ?? 0) + 1
    this.diffGen.set(id, gen)
    let last = JSON.stringify(this.deps.store.diffs(id))
    for (const delay of this.diffDelays) {
      await new Promise((r) => setTimeout(r, delay))
      if (this.diffGen.get(id) !== gen) return
      try {
        const found = await withDeadline(kernel.diff(ks), this.readTimeoutMs)
        if (this.diffGen.get(id) !== gen) return
        const turns = this.deps.store.kernelTurns(id)
        const files: FileDiffView[] = found
          .filter((d) => d.path)
          .map((d) => ({
            turn: d.turn ? (turns.get(d.turn) ?? d.turn) : turn,
            path: d.path,
            status: d.status,
            additions: d.additions,
            deletions: d.deletions,
            patch: d.patch,
          }))
        const next = JSON.stringify(files)
        if (next === last) continue
        last = next
        this.deps.store.replaceDiffs(id, files)
        this.deps.push('session.diffs', { sessionId: id, files })
      } catch {
        // 内核重启了、应用在退出：下一轮结束时再取
        return
      }
    }
  }

  // 这一轮结束了，排队的消息合成一条接着发
  private sendQueued(id: string): void {
    const queued = this.queues.get(id)
    if (!queued?.length) return
    this.queues.delete(id)
    const session = this.deps.store.session(id)
    if (session) {
      this.startTurn(
        session,
        queued.map((q) => q.text).join('\n\n'),
        queued.flatMap((q) => q.attachments),
      )
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
    this.commit(sessionId, change, isDelta)
    if (event.type === 'done' && event.reason === 'completed')
      this.saveTextOutput(sessionId, recorder)
  }

  // 没有输出格式的 Agent：这一轮的回复正文就是产出
  private saveTextOutput(sessionId: string, recorder: TurnRecorder): void {
    const session = this.deps.store.session(sessionId)
    if (!session || this.deps.resolveAgent(session.agent)?.outputSchema) return
    const text = recorder.answerText()
    if (!text) return
    const saved = this.deps.store.saveDraft({
      sessionId,
      turn: recorder.view.turn,
      kind: 'text',
      aiDraft: text,
    })
    this.deps.push('session.output', saved)
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
