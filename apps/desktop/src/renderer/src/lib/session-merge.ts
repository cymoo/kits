import type { MessageView, PartView, SessionDetail, SessionSummary } from '@kits/core/ipc'

// 推送合进会话快照的规则（lib/sessions.ts 用，单独放这里好测）。
// 快照请求在路上时推送会先缓冲，快照装好后按顺序重放；有的推送比快照还旧，按版本跳过，不把新内容盖回旧的。

export type Reducer = (detail: SessionDetail) => SessionDetail

function upsert<T extends { id: string }>(list: T[], item: T, keep: (old: T) => boolean): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const old = list[i] as T
  if (keep(old)) return list
  const copy = list.slice()
  copy[i] = item
  return copy
}

// 会话列表的快照回来时，查询期间推来的更新可能比快照新：按 updatedAt 取新的，快照里没有的（刚建的）也留着
export function mergeSessionList(
  fresh: SessionSummary[],
  cached: SessionSummary[] | undefined,
): SessionSummary[] {
  const byId = new Map(fresh.map((s) => [s.id, s]))
  for (const c of cached ?? []) {
    const f = byId.get(c.id)
    if (!f || c.updatedAt > f.updatedAt) byId.set(c.id, c)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export const mergeSession =
  (s: SessionSummary): Reducer =>
  (d) =>
    s.updatedAt >= d.session.updatedAt ? { ...d, session: s } : d

// 消息没有版本号：已经结束的消息不会被“还没结束”的旧推送盖掉
export const mergeMessage =
  (m: MessageView): Reducer =>
  (d) => ({
    ...d,
    messages: upsert(d.messages, m, (old) => old.completedAt !== null && m.completedAt === null),
  })

export const mergePart =
  (p: PartView): Reducer =>
  (d) => ({
    ...d,
    parts: upsert(d.parts, p, (old) => old.updatedAt > p.updatedAt),
  })
