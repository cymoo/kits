import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  AskUserInput,
  AskUserResult,
  AttachmentInput,
  CreateSessionInput,
  FileDiffView,
  ImageSupport,
  KernelEvent,
  KitsToolContext,
  MessageView,
  OutputView,
  PartView,
  PermissionMode,
  PushEvents,
  QueuedDraft,
  SessionSearchHit,
  SessionSummary,
  ToolCallRegistry,
} from '@kits/core'
import { effectiveLevel, type PermissionRule, skillPrompt, workdirKey } from '@kits/core'
import type { KernelName } from '@kits/core/ipc'
import {
  type AgentKernel,
  agentPermissions,
  agentSystemPrompt,
  type KernelAttachment,
  type KernelSession,
  kernelAgentOf,
  skillDenies,
} from '@kits/kernel'
import { extractText, imageMime, isImage, MAX_IMAGE_BYTES } from '../attachments/extract'
import type { KernelManager } from '../kernel/kernel-manager'
import { ConfigProblemsError } from '../kernel/kernel-manager'
import { sessionMarkdown } from './export'
import { projectInstructions } from './project-instructions'
import type { SessionStore } from './session-store'
import { type TurnChange, TurnRecorder } from './thread'

// 会话编排（phase1-implementation 5.2 节）：建会话、发一轮、事件落库并推给界面、停止。
// 状态机：running → waiting（等确认 / 回答）→ running → done | error | aborted。
// 运行中发的消息先排队，这一轮结束后合成一条发出去；停止会清掉队列。

export interface SessionServiceDeps {
  store: SessionStore
  kernels: Pick<KernelManager, 'acquire' | 'release'>
  // 建内核会话时要 Agent 配置和 MCP 设置来算权限
  // 按工作目录找 Agent（项目的在 <工作目录>/.agents/agents）
  resolveAgent: (name: string, workdir: string) => Parameters<typeof agentPermissions>[0]
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
  // 这个模型现在能不能收图片（`<网关 id>/<模型 id>`，空串是默认模型）；restarting：开关打开了，内核还没重启
  imageSupport: (model: string, kernel: KernelName) => ImageSupport
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

// 存好的附件，等这一轮的用户消息建好再落库。文档转好了文字，图片没有 text，发的时候读原文件
interface StagedAttachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
  textPath?: string
  text?: string
}

// 图片要发给哪个模型、走哪个内核
interface ImageTarget {
  model: string
  kernel: KernelName
}

function imageUrl(mime: string, file: string): string {
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

// 发给内核的形状：图片这时才读出来，排队期间不占内存
function toKernel(a: StagedAttachment): KernelAttachment {
  return a.text === undefined
    ? { name: a.name, mime: a.mime, dataUrl: imageUrl(a.mime, a.path) }
    : { name: a.name, text: a.text }
}

// 运行中发的一条消息，排队到这一轮结束
interface Queued {
  id: string
  text: string
  attachments: StagedAttachment[]
}

// 导出文件名：日期-标题，去掉文件名里不能用的字符
export function exportName(title: string, at: number): string {
  const d = new Date(at)
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const slug =
    title
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || '产出'
  return `${date}-${slug}`
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
  // 这一轮带的附件，随消息发给内核
  attachments: KernelAttachment[]
  // 这一轮的消息进了内核：之后才能插话，插话要排在它后面
  submitted: boolean
  // Agent 的提示词，插话时一样带上
  system: string
}

type PermissionReply = 'once' | 'always' | 'reject'

// 插话在内核里是单独一条用户消息：同一轮同一个文件可能有几份改动，这里合成一份
export function mergeDiffs(files: FileDiffView[]): FileDiffView[] {
  const merged = new Map<string, FileDiffView>()
  for (const f of files) {
    const key = `${f.turn}:${f.path}`
    const prev = merged.get(key)
    merged.set(
      key,
      prev
        ? {
            ...prev,
            additions: prev.additions + f.additions,
            deletions: prev.deletions + f.deletions,
            patch: `${prev.patch}\n${f.patch}`,
          }
        : f,
    )
  }
  return [...merged.values()]
}

// 任务前 40 个字当标题，换行压成空格
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || '新会话'
}

export class SessionService {
  private running = new Map<string, Running>()
  // 正在手动压缩的会话
  private compacting = new Set<string>()
  private queues = new Map<string, Queued[]>()
  // 从排队里拿出来、正在交给内核的
  private delivering = new Map<string, Queued[]>()
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
    // 早期版本把回复正文也记成产出，现在只认 submit_output 交的
    return this.deps.store.outputs(id).filter((o) => o.kind === 'structured')
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
    const file = this.writeExport(session?.title ?? '', at, input.format, text)
    const marked = this.deps.store.markExported(input.id, input.format, at)
    if (marked) this.deps.push('session.output', marked)
    return { path: file }
  }

  // 导出整个会话：Markdown 读，JSON 是完整记录
  exportSession(input: { id: string; format: 'markdown' | 'json' }): { path: string } {
    const detail = this.deps.store.detail(input.id)
    if (!detail) throw new Error(`没有这个会话：${input.id}`)
    const text =
      input.format === 'markdown' ? sessionMarkdown(detail) : JSON.stringify(detail, null, 2)
    return { path: this.writeExport(detail.session.title, this.now(), input.format, text) }
  }

  private writeExport(
    title: string,
    at: number,
    format: 'markdown' | 'json',
    text: string,
  ): string {
    mkdirSync(this.deps.exportsDir, { recursive: true })
    const base = exportName(title, at)
    const ext = format === 'markdown' ? 'md' : 'json'
    // 同一天同名的任务不互相覆盖：重名就加序号
    let file = path.join(this.deps.exportsDir, `${base}.${ext}`)
    for (let n = 2; existsSync(file); n++)
      file = path.join(this.deps.exportsDir, `${base}-${n}.${ext}`)
    writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`)
    return file
  }

  // kits 工具服务：这次工具调用属于哪个会话（remember 按会话的工作目录写项目记忆）
  sessionFor(ctx: KitsToolContext): SessionSummary | undefined {
    const found = this.findRun(ctx.sessionId)
    return found ? this.deps.store.session(found[0]) : undefined
  }

  // kits 工具服务：会话的 Agent 的输出格式（有它才提供 submit_output）
  outputSchema(ctx: KitsToolContext): Record<string, unknown> | undefined {
    const found = this.findRun(ctx.sessionId)
    const session = found ? this.deps.store.session(found[0]) : undefined
    return session
      ? this.deps.resolveAgent(session.agent, session.workdir)?.outputSchema
      : undefined
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
    const canInterject = this.running.get(s.id)?.kernel?.capabilities.interject
    return {
      ...s,
      ...(queued?.length
        ? {
            queued: queued.map((q) => ({
              id: q.id,
              text: q.text,
              attachments: q.attachments.map((a) => ({ name: a.name, size: a.size })),
            })),
          }
        : {}),
      ...(canInterject ? { canInterject } : {}),
    }
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async create(input: CreateSessionInput): Promise<SessionSummary> {
    const id = this.id()
    // 先存附件、转文字：读不了的文件直接报错，会话不建
    const staged = await this.stage(id, input.attachments ?? [], input)
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
      pinnedAt: null,
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
    const staged = await this.stage(id, attachments, this.targetOf(id))
    if ((this.abortGen.get(id) ?? 0) !== gen) {
      this.unstage(staged)
      return
    }
    // 转附件要时间，回来时会话的状态可能变了，重新读
    const session = this.deps.store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    // 正在跑一轮、或正在压缩：排到它结束
    if (this.running.has(id) || this.compacting.has(id)) {
      const queued = { id: this.id(), text, attachments: staged }
      this.queues.set(id, [...(this.queues.get(id) ?? []), queued])
      this.deps.push('session.changed', this.view(session))
      return
    }
    this.startTurn(session, text, staged)
  }

  private targetOf(id: string): ImageTarget {
    const session = this.deps.store.session(id)
    return { model: session?.model ?? '', kernel: session?.kernel ?? 'opencode' }
  }

  // 图片附件的 data URL，给消息里的缩略图用
  attachmentImage(id: string): string | null {
    const file = this.deps.store.attachmentFile(id)
    if (!file?.mime.startsWith('image/') || !existsSync(file.path)) return null
    return imageUrl(file.mime, file.path)
  }

  // 拿走排队的消息，附件读回来放进草稿，磁盘上的副本删掉
  private toDraft(items: Queued[]): QueuedDraft | null {
    if (!items.length) return null
    const attachments = items.flatMap((q) =>
      q.attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        data: new Uint8Array(readFileSync(a.path)),
      })),
    )
    for (const q of items) this.unstage(q.attachments)
    return { text: items.map((q) => q.text).join('\n\n'), attachments }
  }

  // 从队列里摘掉；只给 queueId 时摘那一条，不给就全部
  private takeQueued(id: string, queueId?: string): Queued[] {
    const queued = this.queues.get(id) ?? []
    const taken = queueId ? queued.filter((q) => q.id === queueId) : queued
    const left = queued.filter((q) => !taken.includes(q))
    if (left.length) this.queues.set(id, left)
    else this.queues.delete(id)
    if (taken.length) this.pushSession(id)
    return taken
  }

  private pushSession(id: string): void {
    const s = this.deps.store.session(id)
    if (s) this.deps.push('session.changed', this.view(s))
  }

  dequeue(id: string, queueId: string): QueuedDraft | null {
    return this.toDraft(this.takeQueued(id, queueId))
  }

  async interject(input: {
    id: string
    queueId?: string
    text?: string
    attachments?: AttachmentInput[]
  }): Promise<void> {
    const { id, text } = input
    const gen = this.abortGen.get(id) ?? 0
    const stopped = () => (this.abortGen.get(id) ?? 0) !== gen
    if (text) await this.interjectText(id, text, input.attachments ?? [], stopped)
    else await this.interjectQueued(id, this.takeQueued(id, input.queueId), stopped)
  }

  // 输入框里的文字：发不出去就报错，文字还留在输入框；内核还没准备好、这一轮的模型看不了图时才排队
  private async interjectText(
    id: string,
    text: string,
    attachments: AttachmentInput[],
    stopped: () => boolean,
  ): Promise<void> {
    const staged = await this.stage(id, attachments, this.targetOf(id))
    const item = { id: this.id(), text, attachments: staged }
    let sent = false
    try {
      if (!stopped()) sent = await this.deliver(id, item, stopped)
      if (stopped()) throw new Error('已经停止了，这条没有发出去')
    } catch (e) {
      this.unstage(item.attachments)
      throw e
    }
    if (!sent) this.requeue(id, [item])
  }

  // 正在送的算在 delivering 里：这时点停止，abort 把它们连同排队的一起退回去，这里不再放回队列
  private async interjectQueued(
    id: string,
    items: Queued[],
    stopped: () => boolean,
  ): Promise<void> {
    this.delivering.set(id, [...(this.delivering.get(id) ?? []), ...items])
    const settle = (item: Queued) =>
      this.delivering.set(
        id,
        (this.delivering.get(id) ?? []).filter((q) => q !== item),
      )
    try {
      for (const item of items) {
        if (!(await this.deliver(id, item, stopped))) break
        settle(item)
      }
    } catch (e) {
      // 停止会取消还在路上的请求，这不算失败
      if (!stopped()) throw e
    } finally {
      const left = (this.delivering.get(id) ?? []).filter((q) => items.includes(q))
      for (const item of left) settle(item)
      if (!this.delivering.get(id)?.length) this.delivering.delete(id)
      this.requeue(id, left)
    }
  }

  // 没送出去的放回排队最前面。这一轮这时已经结束的话接着发
  private requeue(id: string, items: Queued[]): void {
    if (!items.length) return
    this.queues.set(id, [...items, ...(this.queues.get(id) ?? [])])
    this.pushSession(id)
    if (!this.running.has(id) && !this.compacting.has(id)) this.sendQueued(id)
  }

  // 交给内核；这一轮还没进内核、已经结束、停止了，或者内核不支持时返回 false。
  // 插话走这一轮发起时的模型，换模型下一条才生效：它看不了图的话也返回 false，排到这一轮结束用新模型发
  private async deliver(id: string, item: Queued, stopped: () => boolean): Promise<boolean> {
    const run = this.running.get(id)
    const session = this.deps.store.session(id)
    if (!session || !run?.kernel || !run.ks || !run.submitted) return false
    const hasImage = item.attachments.some((a) => a.text === undefined)
    const support = this.deps.imageSupport(run.ks.model ?? '', session.kernel)
    if (hasImage && support !== 'yes') return false
    const sent = skillPrompt(item.text, this.deps.enabledSkills?.(session.workdir) ?? [])
    const live = await run.kernel.interject(run.ks, {
      text: sent,
      attachments: item.attachments.map(toKernel),
      ...(run.system ? { system: run.system } : {}),
    })
    // 停止后回来的：这条已经退给用户了，不再记
    if (!live || stopped()) return false
    this.saveAttachments(id, run.recorder.view.id, item.attachments)
    const chips = item.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mime: a.mime,
    }))
    const turn = this.deps.store.nextKernelTurn(id)
    this.commit(id, run.recorder.interject(item.id, item.text, chips, turn))
    return true
  }

  private saveAttachments(id: string, messageId: string, staged: StagedAttachment[]): void {
    for (const a of staged) {
      this.deps.store.saveAttachment({
        id: a.id,
        sessionId: id,
        messageId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        path: a.path,
        textPath: a.textPath ?? null,
      })
    }
    if (staged.length) {
      this.deps.push('session.attachments', {
        sessionId: id,
        attachments: this.deps.store.attachments(id),
      })
    }
  }

  // 附件存到 {attachmentsDir}/<会话>/，原文件和转出来的文字各一份；图片只有原文件。
  // 输入框已经挡过模型看不了图的情况，这里兜底：排队期间、别的窗口改了设置也不把图发给看不了的模型
  private async stage(
    sessionId: string,
    inputs: AttachmentInput[],
    target: ImageTarget,
  ): Promise<StagedAttachment[]> {
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
        const image = isImage(a.name, a.mime)
        const mime = image ? this.checkImage(a, target) : a.mime
        const text = image ? undefined : await extract(a.name, a.mime, a.data)
        const id = this.id()
        const safe = a.name.replace(/[\\/:*?"<>|]+/g, '_')
        const file = path.join(dir, `${id}-${safe}`)
        const size = a.data.byteLength
        mkdirSync(dir, { recursive: true })
        written.push(file)
        writeFileSync(file, a.data)
        if (text === undefined) {
          staged.push({ id, name: a.name, mime, size, path: file })
          continue
        }
        written.push(`${file}.txt`)
        writeFileSync(`${file}.txt`, text)
        staged.push({
          id,
          name: a.name,
          mime,
          size,
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

  // 看得了、不太大、真是图片才收，返回按文件头认出来的类型
  private checkImage(a: AttachmentInput, { model, kernel }: ImageTarget): string {
    const support = this.deps.imageSupport(model, kernel)
    if (support === 'no') {
      throw new Error(`${a.name}：当前模型看不了图片，换一个支持图片的模型，或者去掉它`)
    }
    if (support === 'restarting') {
      throw new Error(`${a.name}：图片开关要等正在跑的任务结束、内核重启后才生效，到时再发`)
    }
    if (a.data.byteLength > MAX_IMAGE_BYTES) throw new Error(`${a.name} 超过 5 MB，压缩一下再发`)
    const mime = imageMime(a.data)
    if (!mime) throw new Error(`${a.name}：不是有效的 PNG、JPEG、WebP 或 GIF 图片`)
    return mime
  }

  // 作废的附件（停止了、没发出去）删掉
  private unstage(staged: StagedAttachment[]): void {
    for (const a of staged) {
      rmSync(a.path, { force: true })
      if (a.textPath) rmSync(a.textPath, { force: true })
    }
  }

  async abort(id: string): Promise<QueuedDraft | null> {
    this.abortGen.set(id, (this.abortGen.get(id) ?? 0) + 1)
    // 排队的消息不发了，退回去放进输入框
    const draft = this.toDraft([...(this.delivering.get(id) ?? []), ...this.takeQueued(id)])
    this.delivering.delete(id)
    const run = this.running.get(id)
    if (!run) return draft
    run.cancelled = true
    // 阻塞提问不再等了；ask_user 先返回，内核才能收尾
    for (const resolve of run.questions.values()) resolve({ answered: false })
    run.questions.clear()
    // 还在启动的轮次在启动完后看到 cancelled 自己结束
    // 停止请求失败时适配器过一会儿自己结束这一轮；草稿已经拿出来了，照样交回去
    if (run.kernel && run.ks) await run.kernel.abort(run.ks).catch(() => {})
    return draft
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
    // “本会话允许”只在 kits 记（part 的状态），不告诉内核：内核按工作目录共享，还会盖过 deny
    const kernelReply = input.reply === 'always' ? 'once' : input.reply
    const live = await run.kernel.respondPermission(run.ks, input.requestId, kernelReply, message)
    const change = live
      ? run.recorder.replyPermission(input.requestId, input.reply, message)
      : run.recorder.expirePermission(input.requestId)
    const part = change.parts[0]
    if (live && part?.payload.type === 'permission') {
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
    if (live && input.reply === 'always' && current) await this.answerCovered(input.id)
  }

  // 新规则覆盖到的、还在等回复的请求一起答掉（并行的工具调用），内核不知道这条规则，不会自己放行
  private async answerCovered(id: string): Promise<void> {
    for (const { status, payload } of this.deps.store.detail(id)?.parts ?? []) {
      if (status !== 'pending' || payload.type !== 'permission') continue
      if (!this.running.has(id) || !this.alwaysAllowed(id, payload)) continue
      await this.respondPermission({ id, requestId: payload.requestId, reply: 'once' })
    }
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
    // 搜索索引：用户发了消息、一轮回复结束时更新（回复的正文增量这时已经落库）
    if (m.role === 'user' || m.completedAt !== null) this.deps.store.reindex(m.sessionId)
    this.deps.push('session.message', m)
  }

  search(query: string): SessionSearchHit[] {
    return this.deps.store.search(query).flatMap((hit) => {
      const session = this.deps.store.session(hit.id)
      return session ? [{ ...hit, session: this.view(session) }] : []
    })
  }

  // 手动压缩（会话页“现在压缩”）：内核把前面的对话压成摘要，对话流里留一条分隔线，展开能看摘要。
  // 期间会话显示运行中，发的消息排到压缩之后；失败了分隔线标出错，会话回到原来的状态
  async compact(id: string): Promise<void> {
    const { store, kernels } = this.deps
    const session = store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    if (this.running.has(id) || this.compacting.has(id)) {
      throw new Error('这一轮还在跑，结束后再压缩')
    }
    const ksId = store.kernelSessionId(id)
    if (!ksId) throw new Error('还没有和内核对话过，不用压缩')
    this.compacting.add(id)
    const at = this.now()
    const message: MessageView = {
      id: this.id(),
      sessionId: id,
      role: 'assistant',
      turn: session.turns,
      text: '',
      createdAt: at,
      completedAt: null,
      finishReason: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      contextTokens: 0,
    }
    const part: PartView = {
      id: `${message.id}:compaction`,
      messageId: message.id,
      sessionId: id,
      seq: 0,
      type: 'compaction',
      payload: { type: 'compaction', summary: '' },
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    }
    const savePart = (p: PartView) => {
      store.savePart(p)
      this.deps.push('session.part', p)
    }
    this.saveMessage(message)
    savePart(part)
    this.update(id, { status: 'running' })
    let kernel: AgentKernel | undefined
    try {
      kernel = await kernels.acquire(session.kernel)
      const profile = this.deps.resolveAgent(session.agent, session.workdir)
      const result = await kernel.summarize({
        id: ksId,
        workdir: session.workdir,
        agent: profile ? kernelAgentOf(profile) : session.agent,
        ...(session.model ? { model: session.model } : {}),
      })
      const done = this.now()
      savePart({
        ...part,
        payload: { type: 'compaction', summary: result.summary },
        status: 'completed',
        updatedAt: done,
      })
      // 压缩后的上下文从摘要算起
      this.saveMessage({
        ...message,
        completedAt: done,
        finishReason: 'compaction',
        contextTokens: result.tokens,
      })
      this.update(id, { status: 'done', lastError: null })
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      const done = this.now()
      savePart({ ...part, status: 'error', updatedAt: done })
      this.saveMessage({ ...message, completedAt: done, finishReason: 'error' })
      this.update(id, { status: session.status === 'running' ? 'done' : session.status })
      throw new Error(`压缩失败：${reason}`)
    } finally {
      this.compacting.delete(id)
      if (kernel) kernels.release(session.kernel)
      this.sendQueued(id)
    }
  }

  // 还在跑（或在等确认、排着队）的会话不删：先停止，免得删到一半内核还在往里写
  remove(id: string): void {
    if (this.running.has(id) || this.queues.get(id)?.length)
      throw new Error('会话还在运行，先停止再删')
    this.deps.store.remove(id)
    this.mcpOff.delete(id)
    rmSync(path.join(this.deps.attachmentsDir, id), { recursive: true, force: true })
  }

  // 移除工作区：这个目录下的会话一起删。一个都没删之前先把运行中的挡回去
  removeWorkdir(dir: string): void {
    const { store, attachmentsDir } = this.deps
    const key = workdirKey(dir)
    const ids = store
      .list()
      .filter((s) => workdirKey(s.workdir) === key)
      .map((s) => s.id)
    if (
      ids.some(
        (id) => this.running.has(id) || this.compacting.has(id) || this.queues.get(id)?.length,
      )
    )
      throw new Error('这个工作区有会话在运行，先停止再移除')
    store.removeAll(ids)
    for (const id of ids) {
      this.mcpOff.delete(id)
      rmSync(path.join(attachmentsDir, id), { recursive: true, force: true })
    }
  }

  // 不走 update()：改名不是会话有新内容，updatedAt 变了它会跳到“今天”分组
  rename(id: string, title: string): void {
    const trimmed = title.replace(/\s+/g, ' ').trim()
    if (!trimmed) throw new Error('标题不能为空')
    const s = this.deps.store.updateSession(id, { title: trimmed })
    if (!s) throw new Error(`没有这个会话：${id}`)
    // ⌘K 按标题搜
    this.deps.store.reindex(id)
    this.deps.push('session.changed', this.view(s))
  }

  // 不走 update()：置顶不是会话有新内容，updatedAt 变了它会跳到“今天”分组
  setPinned(id: string, pinned: boolean): void {
    const s = this.deps.store.updateSession(id, { pinnedAt: pinned ? this.now() : null })
    if (s) this.deps.push('session.changed', this.view(s))
  }

  // 内核会话已经建好时先改内核，内核拒绝就抛错，权限不变；还没建的话建的时候带上。
  // 不走 update()：和改名一样不算有新内容
  async setPermissionMode(id: string, mode: PermissionMode): Promise<void> {
    const { kernels, store } = this.deps
    const session = store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    if (session.permissionMode === mode) return
    const ksId = store.kernelSessionId(id)
    if (ksId) {
      const profile = this.deps.resolveAgent(session.agent, session.workdir)
      const kernel = await kernels.acquire(session.kernel)
      try {
        await kernel.setPermission(
          {
            id: ksId,
            workdir: session.workdir,
            agent: profile ? kernelAgentOf(profile) : session.agent,
            ...(session.model ? { model: session.model } : {}),
          },
          this.sessionRules({ ...session, permissionMode: mode }, profile),
        )
      } finally {
        kernels.release(session.kernel)
      }
    }
    this.saveSetting(id, { permissionMode: mode }, `permission:${mode}`)
  }

  // 模型随每条消息发给内核：这里只改库。正在跑的这一轮用的是开始时的值
  setModel(id: string, model: string): void {
    const session = this.deps.store.session(id)
    if (!session) throw new Error(`没有这个会话：${id}`)
    if (session.model === model) return
    this.saveSetting(id, { model }, `model:${model}`)
  }

  // 写库、推送，并在对话里留一行
  private saveSetting(
    id: string,
    patch: Pick<Partial<SessionSummary>, 'model' | 'permissionMode'>,
    notice: string,
  ): void {
    const { store, push } = this.deps
    const s = store.updateSession(id, patch)
    if (!s) return
    const at = this.now()
    const message: MessageView = {
      id: this.id(),
      sessionId: id,
      role: 'notice',
      turn: s.turns,
      text: notice,
      createdAt: at,
      completedAt: at,
      finishReason: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      contextTokens: 0,
    }
    store.saveMessage(message)
    push('session.message', message)
    push('session.changed', this.view(s))
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
    this.saveAttachments(session.id, user.id, attachments)
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
      attachments: attachments.map(toKernel),
      submitted: false,
      system: '',
    }
    this.running.set(session.id, run)
    void this.runTurn(session, text, run)
  }

  // 这个会话的完整权限，建内核会话时整串交给内核
  private sessionRules(
    session: SessionSummary,
    profile: ReturnType<SessionServiceDeps['resolveAgent']>,
  ): PermissionRule[] {
    return [
      ...agentPermissions(profile, session.permissionMode, this.deps.loadMcp(), {
        workdir: session.workdir,
        home: homedir(),
      }),
      // 关掉的技能和内核自带的技能：会话规则排在全局后面，这里要再拒绝一遍
      ...skillDenies(this.deps.disabledSkills?.() ?? []),
      // 输入框里关掉的平台：这个会话里它的工具一律不能用（排在最后，最后命中的生效）
      ...(this.mcpOff.get(session.id) ?? []).map((server) => ({
        tool: `${server}_*`,
        pattern: '*',
        level: 'deny' as const,
      })),
    ]
  }

  private allowedBySession(
    session: SessionSummary,
    profile: ReturnType<SessionServiceDeps['resolveAgent']>,
    request: { tool: string; patterns: string[] },
  ): boolean {
    const rules = this.sessionRules(session, profile)
    const patterns = request.patterns.length > 0 ? request.patterns : ['*']
    return patterns.every((p) => effectiveLevel(rules, request.tool, p) === 'allow')
  }

  // 用户在这个会话里点过“本会话允许”的。只有 kits 记：内核收到的都是 once，同类请求每次都来问，这里替用户答
  private alwaysAllowed(sessionId: string, request: { tool: string; patterns: string[] }): boolean {
    const rules = this.deps.store.alwaysRules(sessionId)
    const patterns = request.patterns.length > 0 ? request.patterns : ['*']
    return patterns.every((p) => effectiveLevel(rules, request.tool, p) === 'allow')
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
      // 每轮重新读一遍 Agent：项目 Agent 的文件改了，下一条消息起就按新的提示词
      const profile = this.deps.resolveAgent(session.agent, session.workdir)
      const kernelAgent = profile ? kernelAgentOf(profile) : session.agent
      const ks: KernelSession = existing
        ? {
            id: existing,
            workdir: session.workdir,
            agent: kernelAgent,
            ...(session.model ? { model: session.model } : {}),
          }
        : await kernel.createSession({
            workdir: session.workdir,
            agent: kernelAgent,
            ...(session.model ? { model: session.model } : {}),
            title: session.title,
            permission: this.sessionRules(session, profile),
          })
      if (!existing) store.updateSession(session.id, { kernelSessionId: ks.id })
      run.ks = ks
      // 建内核会话期间点了停止：不再发这一轮
      if (run.cancelled) {
        this.apply(session.id, recorder, { type: 'done', reason: 'aborted' })
        return
      }
      // `/技能名 …`：发给内核时明确让 Agent 先加载这个技能；界面上的用户消息照原样
      const sent = skillPrompt(text, this.deps.enabledSkills?.(session.workdir) ?? [])
      // Agent 的提示词随消息带上，接在内核自带的系统提示词后面（内核配置里不写 prompt）
      const system = [
        profile ? agentSystemPrompt(profile) : '',
        kernel.capabilities.projectInstructions ? '' : projectInstructions(session.workdir),
      ]
        .filter(Boolean)
        .join('\n\n')
      run.system = system
      const input = { text: sent, attachments: run.attachments, ...(system ? { system } : {}) }
      for await (const event of kernel.prompt(ks, input)) {
        // 内核有了动静（不是准备阶段就结束）才算这条消息真的进了内核：这时记下它是内核里第几条用户消息
        if (!run.submitted && event.type !== 'done') {
          await this.assignKernelTurn(session, run, kernel, ks)
          run.submitted = true
          this.pushSession(session.id)
        }
        // 内核的子会话只继承主会话的拒绝规则：主会话放行的（比如“全部自动”）这里替用户答了，不弹卡片。
        // 用户允许过的也一样
        // 这一轮里改了权限时内核可能已经在问了，同样替用户答
        if (event.type === 'permission-request') {
          const now = store.session(session.id) ?? session
          const changed = now.permissionMode !== session.permissionMode
          if (
            ((event.subagent || changed) && this.allowedBySession(now, profile, event)) ||
            this.alwaysAllowed(session.id, event)
          ) {
            await kernel.respondPermission(ks, event.requestId, 'once')
            continue
          }
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
        const files = mergeDiffs(
          found
            .filter((d) => d.path)
            .map((d) => ({
              turn: d.turn ? (turns.get(d.turn) ?? d.turn) : turn,
              path: d.path,
              status: d.status,
              additions: d.additions,
              deletions: d.deletions,
              patch: d.patch,
            })),
        )
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
