import { type SessionSummary, type Settings, workdirKey } from '@kits/core/ipc'

// 侧栏的工作区：设置里的目录和所有会话的目录取并集，所以旧数据不用迁移。置顶的会话单独一组，不在这里列。
// 组的顺序按最近开始的会话算，不按最新消息：后台会话有新内容时组不会跳。

export interface Workspace {
  key: string
  path: string
  name: string
  // 组里显示的会话（不含置顶的），最近活动的在前
  sessions: SessionSummary[]
  // 这个工作区下全部会话，含置顶的；移除时都会删
  all: SessionSummary[]
  order: number
}

export function isBusy(s: SessionSummary): boolean {
  return s.status === 'running' || s.status === 'waiting' || !!s.queued?.length
}

export function dirName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) ?? path
}

export function buildWorkspaces(
  workdirs: Settings['workdirs'],
  sessions: SessionSummary[],
): Workspace[] {
  const byKey = new Map<string, Workspace>()
  const at = (path: string): Workspace => {
    const key = workdirKey(path)
    let w = byKey.get(key)
    if (!w) {
      w = { key, path, name: dirName(path), sessions: [], all: [], order: 0 }
      byKey.set(key, w)
    }
    return w
  }
  for (const d of workdirs) {
    const w = at(d.path)
    if (d.label) w.name = d.label
    w.order = Math.max(w.order, d.lastUsedAt)
  }
  for (const s of sessions) {
    const w = at(s.workdir)
    w.all.push(s)
    if (s.pinnedAt === null) w.sessions.push(s)
    w.order = Math.max(w.order, s.createdAt)
  }
  const list = [...byKey.values()]
  for (const w of list) w.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return list.sort((a, b) => b.order - a.order || a.name.localeCompare(b.name))
}

// 折叠时放到组标题上的状态点：等处理最要紧，其次出错，再次运行中
export function foldedStatus(w: Workspace): SessionSummary['status'] | undefined {
  return (['waiting', 'error', 'running'] as const).find((st) =>
    w.sessions.some((s) => s.status === st),
  )
}
