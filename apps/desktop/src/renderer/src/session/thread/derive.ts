import type { PartPayload, PartView, SessionActivity, SessionDetail } from '@kits/core/ipc'
import { formatDuration } from '../../lib/use-now'

// parts → 会话页的块（phase1-implementation 6.4 节）。纯函数，界面只渲染块。
// 一轮 = 一条用户消息 + 一条助手消息。助手消息里：最后一个工具之后的正文是“正文”块，
// 之前的思考、工具、过程中说的话都收进“工作过程”块。
// 中途插话把助手消息切成几段，每段一个工作过程，插的话夹在中间。

export type StepIcon =
  | 'read'
  | 'search'
  | 'command'
  | 'edit'
  | 'new'
  | 'web'
  | 'task'
  | 'plan'
  | 'skill'
  | 'memory'
  | 'output'
  | 'platform'
  | 'note'
  | 'tool'

// todowrite 写下的计划的一项
export interface TodoItem {
  text: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface Step {
  id: string
  // 读取文件 / 搜索 / 执行命令 …
  kind: string
  // 行内的动词：读取 / 搜索 / 运行 …
  verb: string
  icon: StepIcon
  detail: string
  state: 'running' | 'done' | 'error'
  // 行右边的字：耗时、退出码、行数、允许方式
  meta?: string
  // 模型写的一句话描述，有就当标题，detail 退到第二行
  desc?: string
  command?: boolean
  // MCP 工具的参数，格式化好的 JSON
  args?: string
  // 点开看的结果：命令的输出、文件内容、搜索结果、报错
  output?: string
  // 子任务：派给它的话和它走过的步骤
  prompt?: string
  subSteps?: Step[]
  // 更新计划：这一步写下的清单，点开看
  todos?: TodoItem[]
  // 命令框底部的一行：行上没写的耗时和允许方式
  foot?: string
  // 失败的步骤默认展开，算进“N 步失败”。拒绝、中断不算：那是人停的，不是工具出错
  failed?: boolean
  // 改文件的步骤：结果是 diff，点了跳到“改动”里这个文件
  file?: string
  // 通过校验的产出：点了跳到“产出”
  toOutput?: boolean
  // 在跑的命令从这时候算耗时
  startedAt?: number
  // meta 是改了多少行
  isStat?: boolean
  // 这一轮还在跑时模型说的话：整段放在工作过程里，caret 表示还在输出。结束后才分出最终回复，运行中不搬动
  live?: { text: string; caret: boolean }
}

export type Block =
  | {
      kind: 'user'
      id: string
      text: string
      attachments: { name: string; size: number }[]
      // 插话：模型还没看到
      pending?: boolean
    }
  | {
      kind: 'turn'
      id: string
      turn: number
      // 插话之后接着做的部分
      state: 'running' | 'done' | 'failed'
      steps: Step[]
      reasoning: string
      startedAt: number
      endedAt: number | null
      filesChanged: number
      // 收起时标题上的摘要
      summary: { tasks: number; reads: number; searches: number; commands: number; calls: number }
      failed: number
    }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'status'; id: string; text: string; since: number }
  | {
      kind: 'permission'
      id: string
      requestId: string
      tool: string
      // 卡片上要确认的东西：命令、文件路径或参数
      subject: string
      // 哪个子任务要确认的
      subtask?: string
      // “本会话允许”的规则，空表示内核不支持
      always: string[]
    }
  | {
      kind: 'question'
      id: string
      questionId: string
      question: string
      options: string[]
      assumption?: string
      blocking: boolean
      // pending：可以回答；answered：已回答；expired：这一轮结束时还没回答（阻塞提问）
      state: 'pending' | 'answered' | 'expired'
      answer?: string
    }
  | { kind: 'retry'; id: string; attempt: number; message: string; nextAt: number }
  // 上下文压缩的分隔线：手动压缩是单独一条助手消息；内核自动压缩夹在某一轮里（没有摘要正文）
  | {
      kind: 'compaction'
      id: string
      state: 'running' | 'done' | 'failed'
      // 压掉了前几轮
      summary: string
      at: number
    }
  // last：是不是最后一轮（只有最后一轮能“继续”）
  | {
      kind: 'error'
      id: string
      message: string
      last: boolean
      // 这一轮还没发到内核就失败了（配置不完整、内核起不来）：内核里没有原任务，要重发原文而不是说“继续”
      resend?: string
    }

type ToolPayload = Extract<PartPayload, { type: 'tool' }>

// 工作目录里的文件显示相对路径。两边先统一成 /：Windows 上工作目录是 C:\repo，内核给的路径可能用任一种分隔符
function rel(file: unknown, workdir: string): string {
  if (typeof file !== 'string') return ''
  const slash = (p: string) => p.replace(/\\/g, '/')
  const base = `${slash(workdir).replace(/\/+$/, '')}/`
  const f = slash(file)
  return f.startsWith(base) ? f.slice(base.length) : file
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch'])

// apply_patch 的参数是 patchText（*** Add / Update / Delete File: <路径>），没有 filePath
export function patchOps(
  input: unknown,
  workdir: string,
): { path: string; op: 'Add' | 'Update' | 'Delete' }[] {
  const text = str((input as Record<string, unknown> | undefined)?.patchText)
  const seen = new Map<string, 'Add' | 'Update' | 'Delete'>()
  for (const m of text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    const path = rel((m[2] ?? '').trim(), workdir)
    if (!seen.has(path)) seen.set(path, m[1] as 'Add' | 'Update' | 'Delete')
  }
  return [...seen].map(([path, op]) => ({ path, op }))
}

export function patchTargets(input: unknown, workdir: string): string[] {
  return patchOps(input, workdir).map((p) => p.path)
}

const TODO_STATUS = new Set<string>(['pending', 'in_progress', 'completed', 'cancelled'])

// todowrite 的参数是模型写的，形状不对的项跳过
export function todosOf(input: unknown): TodoItem[] {
  const list = (input as { todos?: unknown } | undefined)?.todos
  if (!Array.isArray(list)) return []
  return list.flatMap((t: { content?: unknown; status?: unknown }) => {
    const text = str(t?.content).trim()
    const status = str(t?.status)
    return text
      ? [{ text, status: (TODO_STATUS.has(status) ? status : 'pending') as TodoItem['status'] }]
      : []
  })
}

// 取消的项不算进度
export function todoCounts(items: TodoItem[]): { done: number; total: number } {
  return {
    done: items.filter((t) => t.status === 'completed').length,
    total: items.filter((t) => t.status !== 'cancelled').length,
  }
}

export function todoProgress(items: TodoItem[]): string {
  const { done, total } = todoCounts(items)
  return `${done}/${total}`
}

// 输入框上方的计划卡片：还在跑的这一轮最后写下的计划。上一轮的计划不带过来，结束的轮次在工作过程里看
export function deriveTodos(detail: SessionDetail): TodoItem[] {
  const running = detail.messages.filter((m) => m.role === 'assistant' && m.completedAt === null)
  const ids = new Set(running.map((m) => m.id))
  const last = detail.parts
    .filter(
      (p) => ids.has(p.messageId) && p.payload.type === 'tool' && p.payload.name === 'todowrite',
    )
    .sort((a, b) => a.seq - b.seq)
    .at(-1)
  return last?.payload.type === 'tool' ? todosOf(last.payload.input) : []
}

// 这一步改了哪些文件（工作过程里数“改了 N 个文件”）
function editedFiles(p: ToolPayload, workdir: string): string[] {
  if (p.name === 'apply_patch') return patchTargets(p.input, workdir)
  const file = rel((p.input as Record<string, unknown> | undefined)?.filePath, workdir)
  return file ? [file] : []
}

// 权限请求要确认的东西。参数不截断：MCP 写入请求后面的目标、选项也要让人看到（卡片里限高滚动）；
// 什么都解析不出来时用请求的 patterns 兜底，不让人对着空白授权
export function permissionSubject(
  tool: string,
  input: unknown,
  workdir: string,
  patterns: string[] = [],
): string {
  const i = (input ?? {}) as Record<string, unknown>
  const subject =
    tool === 'bash'
      ? str(i.command)
      : EDIT_TOOLS.has(tool) || tool === 'read'
        ? rel(i.filePath, workdir)
        : tool === 'webfetch'
          ? str(i.url)
          : input === undefined || input === null || JSON.stringify(input) === '{}'
            ? ''
            : JSON.stringify(input, null, 2)
  return subject || patterns.join('\n')
}

const REPLY_META: Record<string, string> = {
  once: '已允许',
  always: '本会话允许',
  reject: '已拒绝',
  // 这一轮结束（停止、出错、应用退出）时还没回复
  expired: '已过期',
}

type ToolLook = Pick<Step, 'kind' | 'verb' | 'icon' | 'detail'>

export function describeTool(p: ToolPayload, workdir: string): ToolLook {
  const input = (p.input ?? {}) as Record<string, unknown>
  switch (p.name) {
    case 'read':
      return { kind: '读取文件', verb: '读取', icon: 'read', detail: rel(input.filePath, workdir) }
    case 'glob':
      return { kind: '搜索', verb: '搜索', icon: 'search', detail: str(input.pattern) }
    case 'grep':
      return {
        kind: '搜索',
        verb: '搜索',
        icon: 'search',
        detail: `grep "${str(input.pattern)}"${input.path ? ` ${rel(input.path, workdir)}` : ''}`,
      }
    case 'list':
      return {
        kind: '列出目录',
        verb: '列出',
        icon: 'search',
        detail: rel(input.path, workdir) || '.',
      }
    case 'bash':
      return { kind: '执行命令', verb: '运行', icon: 'command', detail: str(input.command) }
    case 'edit':
      return { kind: '修改文件', verb: '修改', icon: 'edit', detail: rel(input.filePath, workdir) }
    case 'apply_patch':
      return {
        kind: '修改文件',
        verb: '修改',
        icon: 'edit',
        detail: patchTargets(p.input, workdir).join(', '),
      }
    case 'write':
      return { kind: '新建文件', verb: '新建', icon: 'new', detail: rel(input.filePath, workdir) }
    case 'webfetch':
      return { kind: '读取网页', verb: '读取', icon: 'web', detail: str(input.url) }
    case 'websearch':
      return { kind: '搜索网页', verb: '搜索', icon: 'web', detail: str(input.query) }
    case 'task':
      return { kind: '子任务', verb: '子任务', icon: 'task', detail: str(input.description) }
    case 'todowrite':
      return { kind: '更新计划', verb: '更新计划', icon: 'plan', detail: '' }
    case 'skill':
      return { kind: '使用技能', verb: '使用技能', icon: 'skill', detail: str(input.name) }
    case 'kits_remember':
      return { kind: '记忆', verb: '记下', icon: 'memory', detail: str(input.text) }
    case 'kits_submit_output':
      return { kind: '提交产出', verb: '提交产出', icon: 'output', detail: '' }
    case 'kits_ask_user':
      return { kind: '提问', verb: '提问', icon: 'note', detail: str(input.question) }
    // 模型调了不存在的工具或参数不对，内核转给这个工具，input.tool 是模型想调的
    case 'invalid':
      return { kind: '调用出错', verb: '调用出错', icon: 'tool', detail: str(input.tool) }
    default: {
      // MCP 工具：<服务名>_<工具名>
      const i = p.name.indexOf('_')
      return i > 0
        ? {
            kind: '调用平台',
            verb: '调用',
            icon: 'platform',
            detail: `${p.name.slice(0, i)} · ${p.name.slice(i + 1)}`,
          }
        : { kind: p.name, verb: p.name, icon: 'tool', detail: '' }
    }
  }
}

// 命令耗时：10 秒内带一位小数（0.9 秒、1.2 秒），和原型一致
function commandTime(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} 秒` : formatDuration(ms)
}

// 工具输出里给模型看的部分，界面上不显示：
// OpenCode 在 bash 输出末尾附的 <shell_metadata>，read 外面包的 <path>、<content> 和文件结尾的统计，grep 开头的“Found N matches”。
// 只动这些包装和 grep、glob 列出的路径：正文（源码、命中行、MCP 返回）要原样显示、原样复制
function cleanOutput(name: string, output: unknown, workdir: string): string {
  if (output === undefined || output === null) return ''
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  if (name === 'bash') {
    return text.replace(/\n*<shell_metadata>[\s\S]*?<\/shell_metadata>\s*$/, '').trimEnd()
  }
  if (name === 'task') {
    return (text.match(/<task_result>\n?([\s\S]*?)\n?<\/task_result>/)?.[1] ?? text).trimEnd()
  }
  if (name === 'skill') {
    const body = text.match(
      /<skill_content[^>]*>\n?([\s\S]*?)\n*(?:Base directory for this skill:|<\/skill_content>)/,
    )?.[1]
    return (body ?? text).trimEnd()
  }
  if (name === 'read') {
    const body = text.match(/<content>\n([\s\S]*?)\n*(?:\(End of file[^\n]*\n)?<\/content>/)?.[1]
    return (body ?? text).trimEnd()
  }
  if (name === 'glob') {
    return text
      .split('\n')
      .map((line) => rel(line, workdir))
      .join('\n')
      .trimEnd()
  }
  if (name === 'grep') {
    // 文件名顶格、以冒号结尾，命中行有缩进
    return text
      .replace(/^Found \d+ matches\n/, '')
      .split('\n')
      .map((line) => (/^\S.*:$/.test(line) ? `${rel(line.slice(0, -1), workdir)}:` : line))
      .join('\n')
      .trimEnd()
  }
  return text.trimEnd()
}

// 点开步骤时最多放这么多行，多的要点“显示”才出来：对话里不再套一层滚动
export const OUTPUT_LINES = 12

// 命令留结尾（失败原因和测试汇总都在最后），文件和搜索留开头
export function clipOutput(
  text: string,
  keep: 'head' | 'tail',
  limit = OUTPUT_LINES,
): { text: string; hidden: number } {
  const lines = text.split('\n')
  if (lines.length <= limit) return { text, hidden: 0 }
  const shown = keep === 'tail' ? lines.slice(-limit) : lines.slice(0, limit)
  return { text: shown.join('\n'), hidden: lines.length - limit }
}

// 行右边的数字：读了几行、搜到几处、改了多少行。内核没给就不显示
function toolStat(p: ToolPayload): { meta: string; isStat?: boolean } | undefined {
  if (p.name === 'todowrite') {
    const todos = todosOf(p.input)
    return todos.length ? { meta: todoProgress(todos) } : undefined
  }
  if (p.name === 'kits_submit_output') return { meta: '通过校验', isStat: true }
  if (p.name === 'kits_remember') {
    const { scope } = (p.input ?? {}) as { scope?: unknown }
    return { meta: scope === 'personal' ? '个人记忆' : '项目记忆' }
  }
  if (p.name === 'read' && p.count !== undefined) return { meta: `${p.count} 行` }
  if (p.name === 'grep' && p.count !== undefined) return { meta: `${p.count} 处` }
  if (p.name === 'glob' && p.count !== undefined) return { meta: `${p.count} 个文件` }
  if (p.additions !== undefined || p.deletions !== undefined) {
    const stat = [p.additions ? `+${p.additions}` : '', p.deletions ? `−${p.deletions}` : '']
    return { meta: stat.filter(Boolean).join(' '), isStat: true }
  }
  if (p.name === 'write') {
    const content = str((p.input as Record<string, unknown> | undefined)?.content)
    if (content) return { meta: `+${content.trimEnd().split('\n').length}`, isStat: true }
  }
  return undefined
}

function toolStep(
  p: PartView,
  payload: ToolPayload,
  workdir: string,
  running: boolean,
  reply: string | undefined,
  asking: boolean,
): Step {
  const look = describeTool(payload, workdir)
  const command = payload.name === 'bash'
  const nonZero = payload.exitCode !== undefined && payload.exitCode !== 0
  const interrupted = p.status === 'running' && !running
  // invalid 工具本身跑成功了，但这一步是模型调错了
  const errored = p.status === 'error' || payload.name === 'invalid'
  // 拒绝、过期的命令根本没跑
  const notRun = reply === 'reject' || reply === 'expired'
  const failed = !notRun && (errored || nonZero)
  const how = REPLY_META[reply ?? ''] ?? (asking ? '' : '自动允许')
  const time = payload.durationMs !== undefined ? commandTime(payload.durationMs) : ''
  const stat = !failed && !interrupted && !notRun ? toolStat(payload) : undefined
  const meta = notRun
    ? REPLY_META[reply ?? '']
    : asking
      ? '等待确认'
      : interrupted
        ? '中断'
        : nonZero
          ? `退出 ${payload.exitCode}`
          : errored
            ? payload.name === 'kits_submit_output'
              ? '格式不符'
              : '失败'
            : command
              ? time
              : (REPLY_META[reply ?? ''] ?? stat?.meta)
  const input = (payload.input ?? {}) as Record<string, unknown>
  const output = cleanOutput(payload.name, payload.output, workdir) || (payload.error ?? '')
  const edit = EDIT_TOOLS.has(payload.name) && p.status === 'completed'
  const file = edit ? editedFiles(payload, workdir)[0] : undefined
  const task = payload.name === 'task'
  // 计划的结果就是清单本身，内核回的 JSON 不显示；写失败了还是看报错
  const todos = payload.name === 'todowrite' && !errored ? todosOf(payload.input) : []
  const toOutput = payload.name === 'kits_submit_output' && p.status === 'completed'
  // 这两个成功时只回一句“已提交”“已记住”，行上已经写了
  const quiet = toOutput || (payload.name === 'kits_remember' && !errored)
  return {
    id: p.id,
    ...look,
    state:
      interrupted || errored || nonZero ? 'error' : p.status === 'running' ? 'running' : 'done',
    ...(meta ? { meta } : {}),
    ...(stat?.isStat && meta === stat.meta ? { isStat: true } : {}),
    ...(failed ? { failed } : {}),
    // 改文件成功了结果是 diff；失败时要看报错，还是展开
    ...(file ? { file } : {}),
    ...(toOutput ? { toOutput } : {}),
    ...(todos.length ? { todos } : !edit && !quiet && output ? { output } : {}),
    ...(command
      ? {
          command,
          ...(str(input.description) ? { desc: str(input.description) } : {}),
          ...(notRun ? {} : { foot: [failed ? time : '', how].filter(Boolean).join(' · ') }),
          ...(p.status === 'running' && running && !asking ? { startedAt: p.createdAt } : {}),
        }
      : {}),
    ...(task
      ? {
          subSteps: [],
          ...(str(input.prompt) ? { prompt: str(input.prompt) } : {}),
          ...(p.status === 'running' && running ? { startedAt: p.createdAt } : {}),
        }
      : {}),
    ...(look.icon === 'platform' && Object.keys(input).length
      ? { args: JSON.stringify(input, null, 2) }
      : {}),
  }
}

// 子任务行右边：走了几步、用了多久。在跑时耗时由界面算（Steps.tsx）
function finishTask(step: Step, durationMs: number | undefined): void {
  if (step.state !== 'done' || step.meta) return
  const n = step.subSteps?.length ?? 0
  const time = durationMs !== undefined ? formatDuration(durationMs) : ''
  const meta = [n ? `${n} 步` : '', time].filter(Boolean).join(' · ')
  if (meta) step.meta = meta
}

type InterjectPayload = Extract<PartPayload, { type: 'interject' }>

// 按插话切开：每段带着结尾那条插话，最后一段没有
function splitAtInterjects(parts: PartView[]): { parts: PartView[]; note?: PartView }[] {
  const segments: { parts: PartView[]; note?: PartView }[] = [{ parts: [] }]
  for (const p of parts) {
    const current = segments.at(-1)
    if (p.type !== 'interject') current?.parts.push(p)
    else {
      if (current) current.note = p
      segments.push({ parts: [] })
    }
  }
  return segments
}

function noteBlock(p: PartView, payload: InterjectPayload, pending = false): Block {
  return {
    kind: 'user',
    id: p.id,
    text: payload.text,
    attachments: payload.attachments,
    ...(pending ? { pending } : {}),
  }
}

export function deriveBlocks(
  detail: SessionDetail,
  activity?: SessionActivity,
  now = Date.now(),
): Block[] {
  const { session } = detail
  const byMessage = new Map<string, PartView[]>()
  for (const p of detail.parts) {
    const list = byMessage.get(p.messageId) ?? []
    list.push(p)
    byMessage.set(p.messageId, list)
  }
  const blocks: Block[] = []
  const messages = [...detail.messages].sort(
    (a, b) => a.createdAt - b.createdAt || (a.role === 'user' ? -1 : 1),
  )
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)?.id
  let lastUserText = ''
  for (const m of messages) {
    if (m.role === 'user') {
      blocks.push({
        kind: 'user',
        id: m.id,
        text: m.text,
        attachments: (detail.attachments ?? [])
          .filter((a) => a.messageId === m.id)
          .map((a) => ({ name: a.name, size: a.size })),
      })
      lastUserText = m.text
      continue
    }
    const all = (byMessage.get(m.id) ?? []).sort((a, b) => a.seq - b.seq)
    const open = m.completedAt === null
    for (const p of all) {
      if (p.payload.type !== 'compaction') continue
      blocks.push({
        kind: 'compaction',
        id: p.id,
        state:
          p.status === 'pending' && open
            ? 'running'
            : p.status === 'error' || p.status === 'expired'
              ? 'failed'
              : 'done',
        summary: p.payload.summary,
        at: p.updatedAt,
      })
    }
    if (all.length > 0 && all.every((p) => p.payload.type === 'compaction')) continue
    // 模型还没看到的插话排在最后，看到时才有位置
    const waitingNotes = all.filter((p) => p.type === 'interject' && p.status === 'pending')
    const placed = all.filter((p) => !waitingNotes.includes(p))
    const segments = splitAtInterjects(placed)
    // 回复过的权限请求标在对应的工具步骤上
    const replies = new Map<string, string>()
    const asking = new Set<string>()
    for (const p of all) {
      if (p.payload.type !== 'permission' || !p.payload.callId || !p.status) continue
      if (p.status === 'pending') asking.add(p.payload.callId)
      else replies.set(p.payload.callId, p.status)
    }
    segments.forEach(({ parts, note }, si) => {
      const isLast = si === segments.length - 1
      const running = open && isLast
      const startedAt = segments[si - 1]?.note?.updatedAt ?? m.createdAt
      const suffix = si === 0 ? '' : `:${si}`
      const lastTool = parts.map((p) => p.type).lastIndexOf('tool')
      const steps: Step[] = []
      // 这条消息里的子任务：callId → 步骤
      const tasks = new Map<string, Step>()
      const reasoning: string[] = []
      const answer: string[] = []
      const files = new Set<string>()
      const cards: Block[] = []
      const finishes: (() => void)[] = []
      let error: string | undefined
      parts.forEach((p, i) => {
        const payload = p.payload
        if (payload.type === 'reasoning') reasoning.push(payload.text)
        else if (payload.type === 'text') {
          if (!running && i > lastTool) answer.push(payload.text)
          else if (payload.text.trim() && running) {
            steps.push({
              id: p.id,
              kind: '说明',
              verb: '',
              icon: 'note',
              detail: '',
              state: 'done',
              live: { text: payload.text.trim(), caret: i > lastTool },
            })
          } else if (payload.text.trim()) {
            const said = payload.text.trim()
            const line = said.split('\n')[0] ?? ''
            steps.push({
              id: p.id,
              kind: '说明',
              verb: '',
              icon: 'note',
              detail: '',
              desc: line,
              state: 'done',
              ...(said === line ? {} : { output: said }),
            })
          }
        } else if (payload.type === 'tool') {
          if (EDIT_TOOLS.has(payload.name) && p.status === 'completed') {
            for (const f of editedFiles(payload, session.workdir)) files.add(f)
          }
          // 提问在对话里有自己的卡片
          if (payload.name === 'kits_ask_user') return
          const step = toolStep(
            p,
            payload,
            session.workdir,
            running,
            replies.get(payload.callId),
            open && asking.has(payload.callId),
          )
          const task = payload.parentCallId ? tasks.get(payload.parentCallId) : undefined
          if (task) task.subSteps?.push(step)
          else steps.push(step)
          if (payload.name === 'task' && !payload.parentCallId) {
            tasks.set(payload.callId, step)
            finishes.push(() => finishTask(step, payload.durationMs))
          }
        } else if (payload.type === 'permission') {
          const subject = permissionSubject(
            payload.tool,
            payload.input,
            session.workdir,
            payload.patterns,
          )
          // 卡片排在插话前面也要显示：内核在等它
          if (p.status === 'pending' && open) {
            const subtask = payload.subagent
              ? tasks.get(payload.callId?.split('/')[0] ?? '')?.detail
              : undefined
            cards.push({
              kind: 'permission',
              id: p.id,
              requestId: payload.requestId,
              tool: payload.tool,
              subject,
              always: payload.always,
              ...(subtask ? { subtask } : {}),
            })
          } else if (
            !payload.callId ||
            !all.some((x) => x.payload.type === 'tool' && x.payload.callId === payload.callId)
          ) {
            // 没有对应工具步骤的（拒绝后工具没跑、过期的）单独记一步
            steps.push({
              id: p.id,
              ...describeTool(
                { type: 'tool', callId: '', name: payload.tool, input: payload.input },
                session.workdir,
              ),
              detail: subject,
              state: p.status === 'reject' ? 'error' : 'done',
              meta: REPLY_META[p.status ?? ''] ?? '没有确认',
            })
          }
        } else if (payload.type === 'question') {
          cards.push({
            kind: 'question',
            id: p.id,
            questionId: payload.questionId,
            question: payload.question,
            options: payload.options,
            ...(payload.assumption ? { assumption: payload.assumption } : {}),
            blocking: payload.blocking,
            // 不阻塞的提问轮次结束（甚至应用退出）后还能回答，不显示成过期
            state:
              payload.answer !== undefined
                ? 'answered'
                : p.status === 'expired' && payload.blocking
                  ? 'expired'
                  : 'pending',
            ...(payload.answer !== undefined ? { answer: payload.answer } : {}),
          })
        } else if (payload.type === 'error') error = payload.message
      })
      for (const finish of finishes) finish()
      const hasWork = steps.length > 0 || reasoning.length > 0
      if (hasWork) {
        blocks.push({
          kind: 'turn',
          id: `${m.id}:turn${suffix}`,
          turn: m.turn,
          state: !isLast
            ? 'done'
            : running
              ? 'running'
              : m.finishReason === 'completed'
                ? 'done'
                : 'failed',
          steps,
          reasoning: reasoning.join(''),
          startedAt,
          endedAt: note?.updatedAt ?? m.completedAt,
          filesChanged: files.size,
          summary: {
            tasks: tasks.size,
            reads: new Set(steps.filter((s) => s.icon === 'read').map((s) => s.detail)).size,
            searches: steps.filter((s) => s.icon === 'search').length,
            commands: steps.filter((s) => s.command).length,
            calls: steps.filter((s) => s.icon === 'platform').length,
          },
          failed: steps.filter((s) => s.failed).length,
        })
      }
      blocks.push(...cards)
      // 重试条：最近更新的 part 是重试，说明还没恢复。按更新时间看，不按 seq：
      // 重试后接着写的正文复用原来的 part，seq 还在重试之前
      // 确认和提问的更新是本地回复造成的，不代表内核恢复了：它们只看出现的时间
      const kernelAt = (p: PartView) =>
        p.type === 'question' || p.type === 'permission' ? p.createdAt : p.updatedAt
      const lastPart = parts.reduce<PartView | undefined>(
        (a, p) => (!a || kernelAt(p) >= kernelAt(a) ? p : a),
        undefined,
      )
      const retrying = running && lastPart?.payload.type === 'retry'
      if (retrying && lastPart?.payload.type === 'retry') {
        const { attempt, message, nextAt } = lastPart.payload
        blocks.push({ kind: 'retry', id: lastPart.id, attempt, message, nextAt })
      }
      const text = answer.join('')
      if (text) blocks.push({ kind: 'text', id: `${m.id}:text${suffix}`, text })
      if (note?.payload.type === 'interject') blocks.push(noteBlock(note, note.payload))
      if (!isLast) return
      for (const p of waitingNotes) {
        if (p.payload.type === 'interject') blocks.push(noteBlock(p, p.payload, open))
      }
      if (error) {
        blocks.push({
          kind: 'error',
          id: `${m.id}:error`,
          message: error,
          last: m.id === lastAssistant,
          ...(parts.every((p) => p.type === 'error') ? { resend: lastUserText } : {}),
        })
      }
      // 状态行：这一轮跑着就一直在，只换文字，不然每隔 2 秒没新内容就多一行、来了内容又少一行，对话会跳；
      // 在等你确认 / 回答、在重试时不显示
      const waiting =
        all.some((p) => p.type === 'permission' && p.status === 'pending') ||
        cards.some((c) => c.kind === 'question' && c.blocking && c.state === 'pending')
      if (running && !waiting && !retrying) {
        const last = Math.max(m.createdAt, ...parts.map((p) => p.updatedAt))
        const runningStep = steps.find((s) => s.state === 'running')
        const stepTitle = runningStep?.desc || runningStep?.detail
        // 子任务在跑时写到它正在做的那一步
        const inner = runningStep?.subSteps?.findLast((s) => s.state === 'running')
        const innerTitle = inner ? ` · ${inner.verb} ${inner.desc || inner.detail}` : ''
        const idle = now - last > 2_000 || parts.length === 0
        const text =
          idle && activity?.state === 'retry'
            ? '模型网关断开，正在重试'
            : runningStep
              ? `正在${runningStep.kind}${stepTitle ? `：${stepTitle}` : ''}${innerTitle}`
              : idle
                ? '等待模型回复'
                : '正在回复'
        blocks.push({ kind: 'status', id: `${m.id}:status`, text, since: last })
      }
    })
  }
  return blocks
}
