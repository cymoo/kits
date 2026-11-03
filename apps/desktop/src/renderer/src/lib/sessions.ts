import type {
  MessageView,
  PartView,
  SessionActivity,
  SessionDetail,
  SessionSummary,
} from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { kits } from './kits'
import { mergeMessage, mergePart, mergeSession, type Reducer } from './session-merge'

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

// 快照请求在路上时收到的推送：快照装好后按顺序重放。gen 区分前后两次打开，旧请求的结果不覆盖新的
const inflight = new Map<string, { gen: number; events: Reducer[] }>()
let gen = 0

function dispatch(id: string, reducer: Reducer) {
  inflight.get(id)?.events.push(reducer)
  const cur = states.get(id)
  if (cur?.detail) set(id, { ...cur, detail: reducer(cur.detail) })
}

// 推送只订阅一次，按会话 id 分发；还没打开过的会话不存
let wired = false
function wire() {
  if (wired) return
  wired = true
  kits.on('session.changed', (s: SessionSummary) => dispatch(s.id, mergeSession(s)))
  kits.on('session.message', (m: MessageView) => dispatch(m.sessionId, mergeMessage(m)))
  kits.on('session.part', (p: PartView) => dispatch(p.sessionId, mergePart(p)))
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
    const mine = ++gen
    inflight.set(id, { gen: mine, events: [] })
    void kits.session.get(id).then((snapshot) => {
      const pending = inflight.get(id)
      if (pending?.gen !== mine) return
      inflight.delete(id)
      // 快照回来时已经没人看这个会话了，就不存
      if (!listeners.get(id)?.size) return
      const detail = snapshot ? pending.events.reduce((d, r) => r(d), snapshot) : null
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
          inflight.delete(id)
        }
      }
    },
    [id],
  )
  return useSyncExternalStore(subscribe, () => (id ? (states.get(id) ?? EMPTY) : EMPTY))
}
