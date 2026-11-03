import type { SessionSummary } from '@kits/core/ipc'

// 会话历史、首页“继续上次”、⌘K 共用：什么时候、什么状态、按状态筛选。

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 刚刚 / 12 分钟前 / 3 小时前（今天）/ 昨天 14:05 / 周一（7 天内）/ 10月28日 / 2025-10-28
export function whenLabel(at: number, now = Date.now()): string {
  const diff = now - at
  if (diff < 60_000) return '刚刚'
  const d = new Date(at)
  const today = new Date(now)
  const midnight = (back: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime()
  if (at >= midnight(0)) {
    return diff < 3_600_000
      ? `${Math.floor(diff / 60_000)} 分钟前`
      : `${Math.floor(diff / 3_600_000)} 小时前`
  }
  if (at >= midnight(1)) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (at >= midnight(6)) return WEEKDAYS[d.getDay()] ?? ''
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type StateTone = 'accent' | 'warn' | 'danger' | 'muted'

// 状态字的颜色
export const TONE: Record<StateTone, string> = {
  accent: 'text-accent-fg',
  warn: 'text-warn-strong',
  danger: 'text-danger',
  muted: 'text-fg-muted',
}

export function stateOf(status: SessionSummary['status']): { label: string; tone: StateTone } {
  switch (status) {
    case 'running':
      return { label: '运行中', tone: 'accent' }
    case 'waiting':
      return { label: '等你处理', tone: 'warn' }
    case 'error':
      return { label: '出错', tone: 'danger' }
    case 'aborted':
      return { label: '已停止', tone: 'muted' }
    default:
      return { label: '已完成', tone: 'muted' }
  }
}

// 会话历史的状态筛选：等我处理 = 待确认 / 有提问，加上出错的（都要人去看一眼）
export type StatusFilter = 'all' | 'active' | 'attention' | 'done'

export function matchesFilter(s: SessionSummary, filter: StatusFilter): boolean {
  if (filter === 'active') return s.status === 'running' || s.status === 'waiting'
  if (filter === 'attention') return s.status === 'waiting' || s.status === 'error'
  if (filter === 'done') return s.status === 'done' || s.status === 'aborted'
  return true
}

// 首页“继续上次”：先放等人处理的（待确认、提问、出错），再按最近更新，最多 n 个
export function continueCards(list: SessionSummary[], n = 3): SessionSummary[] {
  const rank = (s: SessionSummary) => (s.status === 'waiting' ? 0 : s.status === 'error' ? 1 : 2)
  return [...list].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt).slice(0, n)
}
