import type { SessionSummary } from '@kits/core/ipc'

// 侧栏会话分组：置顶的单独一组放最前，其余按自然日算今天 / 昨天 / 本周（7 天内）/ 更早

export type Group = 'pinned' | 'today' | 'yesterday' | 'week' | 'earlier'

export function groupOf(at: number, now = new Date()): Exclude<Group, 'pinned'> {
  // 按本地日历构造零点，不用减 24 小时：夏令时切换那天一天不是 24 小时
  const midnight = (back: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime()
  if (at >= midnight(0)) return 'today'
  if (at >= midnight(1)) return 'yesterday'
  if (at >= midnight(6)) return 'week'
  return 'earlier'
}

export function groupSessions(
  list: SessionSummary[],
  now = new Date(),
): [Group, SessionSummary[]][] {
  const groups = new Map<Group, SessionSummary[]>()
  for (const s of list) {
    const g = s.pinnedAt === null ? groupOf(s.updatedAt, now) : 'pinned'
    groups.set(g, [...(groups.get(g) ?? []), s])
  }
  // 后置顶的在上面；会话有新内容时位置不动
  groups.get('pinned')?.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  return (['pinned', 'today', 'yesterday', 'week', 'earlier'] as const).flatMap((g) => {
    const items = groups.get(g)
    return items ? [[g, items] as [Group, SessionSummary[]]] : []
  })
}
