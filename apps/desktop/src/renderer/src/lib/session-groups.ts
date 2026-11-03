import type { SessionSummary } from '@kits/core/ipc'

// 侧栏会话分组：按自然日算今天 / 昨天 / 本周（7 天内）/ 更早

export type Group = 'today' | 'yesterday' | 'week' | 'earlier'

export function groupOf(at: number, now = new Date()): Group {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (at >= day) return 'today'
  if (at >= day - 86_400_000) return 'yesterday'
  if (at >= day - 6 * 86_400_000) return 'week'
  return 'earlier'
}

export function groupSessions(
  list: SessionSummary[],
  now = new Date(),
): [Group, SessionSummary[]][] {
  const groups = new Map<Group, SessionSummary[]>()
  for (const s of list) {
    const g = groupOf(s.updatedAt, now)
    groups.set(g, [...(groups.get(g) ?? []), s])
  }
  return (['today', 'yesterday', 'week', 'earlier'] as const).flatMap((g) => {
    const items = groups.get(g)
    return items ? [[g, items] as [Group, SessionSummary[]]] : []
  })
}
