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
  | { kind: 'error'; id: string; message: string }

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
    let error: string | undefined
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
          ...(p.status === 'error' ? { meta: '失败' } : {}),
        })
      } else if (payload.type === 'permission') {
        steps.push({
          id: p.id,
          kind: '等你确认',
          detail: str((payload.input as Record<string, unknown>)?.command) || payload.tool,
          state: p.status === 'pending' ? 'running' : 'done',
          ...(p.status && p.status !== 'pending'
            ? { meta: p.status === 'reject' ? '已拒绝' : '已允许' }
            : {}),
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
    const text = answer.join('')
    if (text) blocks.push({ kind: 'text', id: `${m.id}:text`, text, streaming: running })
    if (error) blocks.push({ kind: 'error', id: `${m.id}:error`, message: error })
    // 状态行：这一轮还在跑，而且最近 2 秒没有新内容（等模型首字、工具在跑）
    if (running) {
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
