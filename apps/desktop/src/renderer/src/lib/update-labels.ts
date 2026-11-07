import type { SessionSummary } from '@kits/core/ipc'

// 版本与更新的显示规则（纯函数，单测在 Node 里跑）

// 重启会打断的会话：在跑的、等人确认或回答的、还有排队消息的
export function busySessionCount(list: SessionSummary[] | undefined): number {
  return (list ?? []).filter(
    (s) => s.status === 'running' || s.status === 'waiting' || !!s.queued?.length,
  ).length
}

// “11 月 7 日”；releaseDate 是 latest.yml 里的 ISO 时间，取不到就不写
export function releaseDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// 上次检查的时间：刚刚、12 分钟前、今天的写时刻、更早的写日期
export function checkedLabel(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const d = new Date(at)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
