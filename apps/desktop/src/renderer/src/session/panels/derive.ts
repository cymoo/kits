import type { FileDiffView, PartView, SessionDetail } from '@kits/core/ipc'

// 右侧面板的数据（phase1-implementation 6.4 节）：改动按轮分组、终端的命令列表、上下文用量、总结卡片。纯函数，有单测。

export interface ChangedFile {
  path: string
  // A 新建、M 修改、D 删除
  badge: 'A' | 'M' | 'D'
  additions: number
  deletions: number
  patch: string
}

export interface Round {
  turn: number
  files: ChangedFile[]
  additions: number
  deletions: number
  // 这一轮还在跑：文件来自 Agent 的编辑步骤，diff 要等这一轮结束内核算出来
  pending: boolean
}

const BADGE = { added: 'A', modified: 'M', deleted: 'D' } as const

function ordered(detail: SessionDetail): { part: PartView; turn: number }[] {
  const turnOf = new Map(detail.messages.map((m) => [m.id, m.turn]))
  const created = new Map(detail.messages.map((m) => [m.id, m.createdAt]))
  return [...detail.parts]
    .sort(
      (x, y) => (created.get(x.messageId) ?? 0) - (created.get(y.messageId) ?? 0) || x.seq - y.seq,
    )
    .map((part) => ({ part, turn: turnOf.get(part.messageId) ?? 0 }))
}

function relative(file: string, workdir: string): string {
  const slash = (p: string) => p.replace(/\\/g, '/')
  const base = `${slash(workdir).replace(/\/+$/, '')}/`
  const f = slash(file)
  return f.startsWith(base) ? f.slice(base.length) : f
}

// 最新的一轮在最上面
export function deriveRounds(detail: SessionDetail, diffs: FileDiffView[]): Round[] {
  const byTurn = new Map<number, ChangedFile[]>()
  for (const d of diffs) {
    const list = byTurn.get(d.turn) ?? []
    list.push({
      path: d.path,
      badge: BADGE[d.status],
      additions: d.additions,
      deletions: d.deletions,
      patch: d.patch,
    })
    byTurn.set(d.turn, list)
  }
  const rounds: Round[] = [...byTurn].map(([turn, files]) => ({
    turn,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    pending: false,
  }))
  // 还在跑的一轮：先按编辑步骤列出改了哪些文件
  const last = detail.messages.filter((m) => m.role === 'assistant').at(-1)
  if (last && last.completedAt === null && !byTurn.has(last.turn)) {
    const files = new Map<string, ChangedFile>()
    for (const { part } of ordered(detail)) {
      const p = part.payload
      if (part.messageId !== last.id || p.type !== 'tool' || part.status !== 'completed') continue
      if (p.name !== 'edit' && p.name !== 'write' && p.name !== 'apply_patch') continue
      const raw = (p.input as { filePath?: unknown } | undefined)?.filePath
      if (typeof raw !== 'string') continue
      const path = relative(raw, detail.session.workdir)
      const prev = files.get(path)
      files.set(path, {
        path,
        badge: prev?.badge ?? (p.name === 'write' ? 'A' : 'M'),
        additions: 0,
        deletions: 0,
        patch: '',
      })
    }
    if (files.size) {
      rounds.push({
        turn: last.turn,
        files: [...files.values()],
        additions: 0,
        deletions: 0,
        pending: true,
      })
    }
  }
  return rounds.sort((x, y) => y.turn - x.turn)
}

export interface Command {
  id: string
  turn: number
  command: string
  output: string
  // running 在跑、waiting 等你确认、done / failed 结束、interrupted 这一轮结束时还没跑完（停止、崩溃、退出）
  state: 'running' | 'waiting' | 'done' | 'failed' | 'interrupted'
  exitCode?: number
  durationMs?: number
  // 自动允许 / 已允许 / 本会话允许 / 已拒绝 / 已过期
  how: string
}

const HOW: Record<string, string> = {
  once: '已允许',
  always: '本会话允许',
  reject: '已拒绝',
  expired: '已过期',
}

// OpenCode 在 bash 输出末尾附了给模型看的 <shell_metadata>，终端里不显示
function cleanOutput(output: unknown): string {
  if (typeof output !== 'string') return ''
  return output.replace(/\n*<shell_metadata>[\s\S]*?<\/shell_metadata>\s*$/, '').trimEnd()
}

export function deriveCommands(detail: SessionDetail): Command[] {
  const parts = ordered(detail)
  const finished = new Set(detail.messages.filter((m) => m.completedAt !== null).map((m) => m.id))
  const asked = new Map<string, PartView>()
  for (const { part } of parts) {
    if (part.payload.type === 'permission' && part.payload.callId)
      asked.set(part.payload.callId, part)
  }
  const out: Command[] = []
  for (const { part, turn } of parts) {
    const p = part.payload
    if (p.type !== 'tool' || p.name !== 'bash') continue
    const command = (p.input as { command?: unknown } | undefined)?.command
    const permission = asked.get(p.callId)
    const waiting = permission?.status === 'pending'
    const state = waiting
      ? 'waiting'
      : part.status === 'running'
        ? finished.has(part.messageId)
          ? 'interrupted'
          : 'running'
        : part.status === 'error' || (p.exitCode !== undefined && p.exitCode !== 0)
          ? 'failed'
          : 'done'
    out.push({
      id: part.id,
      turn,
      command: typeof command === 'string' ? command : '',
      output: cleanOutput(p.output) || (p.error ?? ''),
      state,
      ...(p.exitCode !== undefined ? { exitCode: p.exitCode } : {}),
      ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
      how: permission ? (HOW[permission.status ?? ''] ?? '等待确认') : '自动允许',
    })
  }
  return out
}

// 本会话里点过“本会话允许”的规则
export function alwaysRules(detail: SessionDetail): string[] {
  const rules = new Set<string>()
  for (const p of detail.parts) {
    if (p.payload.type === 'permission' && p.status === 'always') {
      for (const r of p.payload.always) rules.add(r)
    }
  }
  return [...rules]
}

export interface Usage {
  // 最近一次模型调用的输入 token，也就是现在上下文有多大
  context: number
  // 整个会话累计；input 已经含缓存读写
  input: number
  output: number
  cacheRead: number
  cost: number
}

export function deriveUsage(detail: SessionDetail): Usage {
  const replies = detail.messages.filter((m) => m.role === 'assistant')
  const last = [...replies].reverse().find((m) => m.contextTokens > 0)
  return {
    context: last?.contextTokens ?? 0,
    input: replies.reduce((n, m) => n + m.tokens.input, 0),
    output: replies.reduce((n, m) => n + m.tokens.output, 0),
    cacheRead: replies.reduce((n, m) => n + m.tokens.cacheRead, 0),
    cost: replies.reduce((n, m) => n + m.cost, 0),
  }
}

// 42K、1.2M
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
