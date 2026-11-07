import type { FileDiffView, PartView, SessionDetail } from '@kits/core/ipc'
import { patchOps } from '../thread/derive'

// 右侧面板的数据（phase1-implementation 6.4 节）：改动按轮分组、允许规则、上下文用量。纯函数，有单测。

export interface ChangedFile {
  path: string
  // A 新建、M 修改、D 删除
  badge: 'A' | 'M' | 'D'
  additions: number
  deletions: number
  patch: string
  // 这一轮里覆盖写过这个文件（write）：内核不给旧内容，覆盖之前的改动看不到，diff 只有覆盖之后的
  rewrite?: boolean
}

export interface Round {
  turn: number
  // 这一轮用户消息的第一行，分组标题用；只发了附件时为空
  title: string
  files: ChangedFile[]
  additions: number
  deletions: number
  // 这一轮还在跑：文件来自 Agent 的编辑步骤，带了 diff 的先显示，内核的快照 diff 等这一轮结束再换上
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

// 一步改了哪些文件：工具结果里带了就用它（有 diff），没带（老数据、别的内核）按参数列出路径
function stepTargets(
  p: Extract<PartView['payload'], { type: 'tool' }>,
  workdir: string,
): ChangedFile[] {
  if (p.files?.length) {
    return p.files.map((f) => ({
      path: relative(f.path, workdir),
      badge: BADGE[f.status],
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
      ...(p.name === 'write' && f.status === 'modified' && !f.patch ? { rewrite: true } : {}),
    }))
  }
  const blank = { additions: 0, deletions: 0, patch: '' }
  // apply_patch 一次改好几个文件，参数是 patchText；edit / write 是 filePath
  if (p.name === 'apply_patch') {
    return patchOps(p.input, workdir).map((t) => ({
      path: t.path,
      badge: t.op === 'Add' ? 'A' : t.op === 'Delete' ? 'D' : 'M',
      ...blank,
    }))
  }
  const filePath = (p.input as { filePath?: unknown } | undefined)?.filePath
  if (typeof filePath !== 'string') return []
  return [{ path: relative(filePath, workdir), badge: p.name === 'write' ? 'A' : 'M', ...blank }]
}

// 同一轮里同一个文件改了几次合成一份：先新建后修改还是新建，新建后又删了就不算，diff 首尾相接
function mergeStep(prev: ChangedFile | undefined, next: ChangedFile): ChangedFile | undefined {
  if (!prev) return next
  if (prev.badge === 'A' && next.badge === 'D') return undefined
  // 覆盖写：之前的 diff 已经不是这个文件的样子了，作废；后面再改的照常接上，界面提示 diff 不完整
  if (next.rewrite) return { ...next, badge: prev.badge === 'A' ? 'A' : 'M' }
  return {
    path: next.path,
    badge: prev.badge === 'A' ? 'A' : next.badge === 'D' ? 'D' : next.badge === 'A' ? 'A' : 'M',
    additions: prev.additions + next.additions,
    deletions: prev.deletions + next.deletions,
    patch: [prev.patch, next.patch].filter(Boolean).join('\n'),
    ...(prev.rewrite || next.rewrite ? { rewrite: true } : {}),
  }
}

// 每一轮里改文件的步骤（edit / write / apply_patch，做完了的）改了哪些文件
export function stepFiles(detail: SessionDetail): Map<number, ChangedFile[]> {
  const byTurn = new Map<number, Map<string, ChangedFile>>()
  for (const { part, turn } of ordered(detail)) {
    const p = part.payload
    if (p.type !== 'tool' || part.status !== 'completed') continue
    if (p.name !== 'edit' && p.name !== 'write' && p.name !== 'apply_patch') continue
    const files = byTurn.get(turn) ?? new Map<string, ChangedFile>()
    byTurn.set(turn, files)
    for (const target of stepTargets(p, detail.session.workdir)) {
      const merged = mergeStep(files.get(target.path), target)
      if (merged) files.set(target.path, merged)
      else files.delete(target.path)
    }
  }
  return new Map([...byTurn].map(([turn, files]) => [turn, [...files.values()]]))
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
  const titles = new Map(
    detail.messages
      .filter((m) => m.role === 'user')
      .map((m) => [m.turn, m.text.trim().split('\n')[0] ?? '']),
  )
  const rounds: Round[] = [...byTurn].map(([turn, files]) => ({
    turn,
    title: titles.get(turn) ?? '',
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    pending: false,
  }))
  // 内核没给快照 diff 的轮次（还在跑；或者工作区不是 Git 仓库，OpenCode 不做快照）：按改文件的步骤列出，
  // 步骤结果里带了 diff 就显示。内核的快照 diff 到了以后整轮换成它，它还算上了命令改的文件
  const last = detail.messages.filter((m) => m.role === 'assistant').at(-1)
  for (const [turn, files] of stepFiles(detail)) {
    if (byTurn.has(turn) || !files.length) continue
    rounds.push({
      turn,
      title: titles.get(turn) ?? '',
      files,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      pending: !!last && last.turn === turn && last.completedAt === null,
    })
  }
  return rounds.sort((x, y) => y.turn - x.turn)
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
