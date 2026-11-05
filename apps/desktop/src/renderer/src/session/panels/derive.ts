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
}

export interface Round {
  turn: number
  // 这一轮用户消息的第一行，分组标题用；只发了附件时为空
  title: string
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
  // 还在跑的一轮：先按编辑步骤列出改了哪些文件
  const last = detail.messages.filter((m) => m.role === 'assistant').at(-1)
  if (last && last.completedAt === null && !byTurn.has(last.turn)) {
    const files = new Map<string, ChangedFile>()
    for (const { part } of ordered(detail)) {
      const p = part.payload
      if (part.messageId !== last.id || p.type !== 'tool' || part.status !== 'completed') continue
      if (p.name !== 'edit' && p.name !== 'write' && p.name !== 'apply_patch') continue
      // apply_patch 一次改好几个文件，参数是 patchText；edit / write 是 filePath
      const targets: { path: string; badge: ChangedFile['badge'] }[] =
        p.name === 'apply_patch'
          ? patchOps(p.input, detail.session.workdir).map((t) => ({
              path: t.path,
              badge: t.op === 'Add' ? 'A' : t.op === 'Delete' ? 'D' : 'M',
            }))
          : typeof (p.input as { filePath?: unknown } | undefined)?.filePath === 'string'
            ? [
                {
                  path: relative(
                    (p.input as { filePath: string }).filePath,
                    detail.session.workdir,
                  ),
                  badge: p.name === 'write' ? 'A' : 'M',
                },
              ]
            : []
      for (const target of targets) {
        const prev = files.get(target.path)
        files.set(target.path, {
          path: target.path,
          // 同一轮里先新建后修改还是“新建”
          badge: prev?.badge === 'A' ? 'A' : target.badge,
          additions: 0,
          deletions: 0,
          patch: '',
        })
      }
    }
    if (files.size) {
      rounds.push({
        turn: last.turn,
        title: titles.get(last.turn) ?? '',
        files: [...files.values()],
        additions: 0,
        deletions: 0,
        pending: true,
      })
    }
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
