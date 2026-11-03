import type {
  FileDiffView,
  MessageView,
  PartView,
  SessionActivity,
  SessionDetail,
  SessionSummary,
} from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { kits } from './kits'

// 会话数据：列表走 TanStack Query，单个会话的对话流放在下面这个小仓库里——
// 打开时用 session.get 拿一次快照，之后主进程推来的 message / part 按 id 合进去，界面只订阅自己那个会话。

export const sessionKeys = { list: ['sessions'] as const }

export function useSessions() {
  return useQuery({ queryKey: sessionKeys.list, queryFn: () => kits.session.list() })
}

// 列表跟着推送更新（侧栏、⌘K、首页都用）
export function useSessionListSync() {
  const client = useQueryClient()
  useEffect(
    () =>
      kits.on('session.changed', (s: SessionSummary) => {
        client.setQueryData<SessionSummary[]>(sessionKeys.list, (list) => {
          const rest = (list ?? []).filter((x) => x.id !== s.id)
          return [s, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
        })
      }),
    [client],
  )
}

export interface LiveSession {
  detail: SessionDetail | null
  loading: boolean
  activity: SessionActivity | undefined
}

type Listener = () => void
const states = new Map<string, LiveSession>()
const listeners = new Map<string, Set<Listener>>()

function set(id: string, next: LiveSession) {
  states.set(id, next)
  for (const l of listeners.get(id) ?? []) l()
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const copy = list.slice()
  copy[i] = item
  return copy
}

// 推送只订阅一次，按会话 id 分发；还没打开过的会话不存
let wired = false
function wire() {
  if (wired) return
  wired = true
  kits.on('session.changed', (s: SessionSummary) => {
    const cur = states.get(s.id)
    if (cur?.detail) set(s.id, { ...cur, detail: { ...cur.detail, session: s } })
  })
  kits.on('session.message', (m: MessageView) => {
    const cur = states.get(m.sessionId)
    if (cur?.detail)
      set(m.sessionId, {
        ...cur,
        detail: { ...cur.detail, messages: upsert(cur.detail.messages, m) },
      })
  })
  kits.on('session.part', (p: PartView) => {
    const cur = states.get(p.sessionId)
    if (cur?.detail)
      set(p.sessionId, { ...cur, detail: { ...cur.detail, parts: upsert(cur.detail.parts, p) } })
  })
  kits.on('session.activity', (a: SessionActivity) => {
    const cur = states.get(a.sessionId)
    if (cur) set(a.sessionId, { ...cur, activity: a })
  })
}

const EMPTY: LiveSession = { detail: null, loading: true, activity: undefined }

export function useLiveSession(id: string | undefined): LiveSession {
  wire()
  useEffect(() => {
    if (!id) return
    const cur = states.get(id)
    if (!cur || (!cur.detail && !cur.loading)) set(id, { ...EMPTY })
    // 每次打开都重新拿一次快照：推送只在打开期间合并，离开期间的变化靠它补
    void kits.session.get(id).then((detail) => {
      // 快照回来时已经没人看这个会话了，就不存
      if (!listeners.get(id)?.size) return
      const now = states.get(id)
      set(id, { detail, loading: false, activity: now?.activity })
    })
  }, [id])
  const subscribe = useCallback(
    (cb: Listener) => {
      if (!id) return () => {}
      let subs = listeners.get(id)
      if (!subs) {
        subs = new Set()
        listeners.set(id, subs)
      }
      subs.add(cb)
      return () => {
        subs?.delete(cb)
        // 最后一个订阅走了就不再留这个会话的数据，推送也不再往里合；下次打开重新拿快照
        if (!subs?.size) {
          listeners.delete(id)
          states.delete(id)
        }
      }
    },
    [id],
  )
  return useSyncExternalStore(subscribe, () => (id ? (states.get(id) ?? EMPTY) : EMPTY))
}

// 会话的改动（右侧面板、总结卡片）。一轮结束后主进程取到内核算好的改动，推过来直接替换
export function useSessionDiffs(id: string | undefined) {
  const client = useQueryClient()
  useEffect(
    () =>
      kits.on('session.diffs', ({ sessionId, files }) =>
        client.setQueryData<FileDiffView[]>(['session', sessionId, 'diffs'], files),
      ),
    [client],
  )
  return useQuery({
    queryKey: ['session', id, 'diffs'],
    queryFn: () => (id ? kits.session.diffs(id) : Promise.resolve([])),
    enabled: !!id,
  })
}
