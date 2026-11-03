import type { PartPayload, PartView, SessionActivity, SessionDetail } from '@kits/core/ipc'

// parts → 会话页的块（phase1-implementation 6.4 节）。纯函数，界面只渲染块。
// 一轮 = 一条用户消息 + 一条助手消息。助手消息里：最后一个工具之后的正文是“正文”块，
// 之前的思考、工具、过程中说的话都收进“工作过程”块。

export interface Step {
  id: string
  // 读取文件 / 搜索 / 执行命令 …
  kind: string
  detail: string
  state: 'running' | 'done' | 'error'
  meta?: string
}

export type Block =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'turn'
      id: string
      turn: number
      state: 'running' | 'done' | 'failed'
      steps: Step[]
      reasoning: string
      startedAt: number
      endedAt: number | null
      filesChanged: number
    }
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  | { kind: 'status'; id: string; text: string; since: number }
  | {
      kind: 'permission'
      id: string
      requestId: string
      tool: string
      // 卡片上要确认的东西：命令、文件路径或参数
      subject: string
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
  // last：是不是最后一轮（只有最后一轮能“继续”）
  | { kind: 'error'; id: string; message: string; last: boolean }

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

// 权限请求要确认的东西
export function permissionSubject(tool: string, input: unknown, workdir: string): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'bash') return str(i.command)
  if (EDIT_TOOLS.has(tool) || tool === 'read') return rel(i.filePath, workdir)
  if (tool === 'webfetch') return str(i.url)
  if (input === undefined || input === null) return ''
  const json = JSON.stringify(input)
  return json === '{}' ? '' : json.length > 200 ? `${json.slice(0, 200)}…` : json
}

const REPLY_META: Record<string, string> = {
  once: '已允许',
  always: '本会话允许',
  reject: '已拒绝',
}

export function describeTool(p: ToolPayload, workdir: string): { kind: string; detail: string } {
  const input = (p.input ?? {}) as Record<string, unknown>
  switch (p.name) {
    case 'read':
      return { kind: '读取文件', detail: rel(input.filePath, workdir) }
    case 'glob':
      return { kind: '搜索', detail: str(input.pattern) }
    case 'grep':
      return {
        kind: '搜索',
        detail: `grep "${str(input.pattern)}"${input.path ? ` ${rel(input.path, workdir)}` : ''}`,
      }
    case 'list':
      return { kind: '列出目录', detail: rel(input.path, workdir) || '.' }
    case 'bash':
      return { kind: '执行命令', detail: str(input.command) }
    case 'edit':
    case 'apply_patch':
      return { kind: '修改文件', detail: rel(input.filePath, workdir) }
    case 'write':
      return { kind: '新建文件', detail: rel(input.filePath, workdir) }
    case 'webfetch':
      return { kind: '读取网页', detail: str(input.url) }
    case 'task':
      return { kind: '子任务', detail: str(input.description) }
    case 'todowrite':
      return { kind: '更新计划', detail: '' }
    case 'skill':
      return { kind: '使用技能', detail: str(input.name) }
    case 'kits_remember':
      return { kind: '记忆', detail: str(input.text) }
    case 'kits_submit_output':
      return { kind: '提交产出', detail: '' }
    case 'kits_ask_user':
      return { kind: '提问', detail: str(input.question) }
    default: {
      // MCP 工具：<服务名>_<工具名>
      const i = p.name.indexOf('_')
      return i > 0
        ? { kind: '调用平台', detail: `${p.name.slice(0, i)} · ${p.name.slice(i + 1)}` }
        : { kind: p.name, detail: '' }
    }
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
  for (const m of messages) {
    if (m.role === 'user') {
      blocks.push({ kind: 'user', id: m.id, text: m.text })
      continue
    }
    const parts = (byMessage.get(m.id) ?? []).sort((a, b) => a.seq - b.seq)
    const running = m.completedAt === null
    const lastTool = parts.map((p) => p.type).lastIndexOf('tool')
    const steps: Step[] = []
    const reasoning: string[] = []
    const answer: string[] = []
    const files = new Set<string>()
    const cards: Block[] = []
    let error: string | undefined
    // 回复过的权限请求标在对应的工具步骤上
    const replies = new Map<string, string>()
    for (const p of parts) {
      if (p.payload.type === 'permission' && p.payload.callId && p.status && p.status !== 'pending')
        replies.set(p.payload.callId, p.status)
    }
    parts.forEach((p, i) => {
      const payload = p.payload
      if (payload.type === 'reasoning') reasoning.push(payload.text)
      else if (payload.type === 'text') {
        if (i > lastTool) answer.push(payload.text)
        else if (payload.text.trim()) {
          steps.push({
            id: p.id,
            kind: '说明',
            detail: payload.text.trim().split('\n')[0] ?? '',
            state: 'done',
          })
        }
      } else if (payload.type === 'tool') {
        const { kind, detail: d } = describeTool(payload, session.workdir)
        if (EDIT_TOOLS.has(payload.name) && p.status === 'completed') files.add(d)
        // 提问在对话里有自己的卡片
        if (payload.name === 'kits_ask_user') return
        const reply = REPLY_META[replies.get(payload.callId) ?? '']
        steps.push({
          id: p.id,
          kind,
          detail: d,
          state:
            p.status === 'running'
              ? running
                ? 'running'
                : 'error'
              : p.status === 'error'
                ? 'error'
                : 'done',
          ...(reply ? { meta: reply } : p.status === 'error' ? { meta: '失败' } : {}),
        })
      } else if (payload.type === 'permission') {
        const subject = permissionSubject(payload.tool, payload.input, session.workdir)
        if (p.status === 'pending' && running) {
          cards.push({
            kind: 'permission',
            id: p.id,
            requestId: payload.requestId,
            tool: payload.tool,
            subject,
            always: payload.always,
          })
        } else if (
          !payload.callId ||
          !parts.some((x) => x.payload.type === 'tool' && x.payload.callId === payload.callId)
        ) {
          // 没有对应工具步骤的（拒绝后工具没跑、过期的）单独记一步
          steps.push({
            id: p.id,
            kind: describeTool(
              { type: 'tool', callId: '', name: payload.tool, input: payload.input },
              session.workdir,
            ).kind,
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
          state:
            payload.answer !== undefined
              ? 'answered'
              : p.status === 'expired'
                ? 'expired'
                : 'pending',
          ...(payload.answer !== undefined ? { answer: payload.answer } : {}),
        })
      } else if (payload.type === 'error') error = payload.message
    })
    const hasWork = steps.length > 0 || reasoning.length > 0
    if (hasWork) {
      blocks.push({
        kind: 'turn',
        id: `${m.id}:turn`,
        turn: m.turn,
        state: running ? 'running' : m.finishReason === 'completed' ? 'done' : 'failed',
        steps,
        reasoning: reasoning.join(''),
        startedAt: m.createdAt,
        endedAt: m.completedAt,
        filesChanged: files.size,
      })
    }
    blocks.push(...cards)
    // 重试条：最后一个 part 是重试，说明还没恢复
    const lastPart = parts.at(-1)
    const retrying = running && lastPart?.payload.type === 'retry'
    if (retrying && lastPart.payload.type === 'retry') {
      const { attempt, message, nextAt } = lastPart.payload
      blocks.push({ kind: 'retry', id: lastPart.id, attempt, message, nextAt })
    }
    const text = answer.join('')
    if (text) blocks.push({ kind: 'text', id: `${m.id}:text`, text, streaming: running })
    if (error) {
      blocks.push({
        kind: 'error',
        id: `${m.id}:error`,
        message: error,
        last: m.id === lastAssistant,
      })
    }
    // 状态行：这一轮还在跑，而且最近 2 秒没有新内容（等模型首字、工具在跑）；
    // 在等你确认 / 回答、在重试时不显示
    const waiting = cards.some(
      (c) =>
        c.kind === 'permission' || (c.kind === 'question' && c.blocking && c.state === 'pending'),
    )
    if (running && !waiting && !retrying) {
      const last = Math.max(m.createdAt, ...parts.map((p) => p.updatedAt))
      const runningStep = steps.find((s) => s.state === 'running')
      if (now - last > 2_000 || parts.length === 0) {
        const text =
          activity?.state === 'retry'
            ? '模型网关断开，正在重试'
            : runningStep
              ? `正在${runningStep.kind}${runningStep.detail ? `：${runningStep.detail}` : ''}`
              : '等待模型回复'
        blocks.push({ kind: 'status', id: `${m.id}:status`, text, since: last })
      }
    }
  }
  return blocks
}
