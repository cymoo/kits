import path from 'node:path'
import type { MessageView, SessionSummary } from '@kits/core'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { HIT_CLOSE, HIT_OPEN, SessionStore } from './session-store'

const migrations = path.resolve(import.meta.dirname, '../../../drizzle')
let close: (() => void) | undefined
afterEach(() => close?.())

function setup() {
  const db = openDatabase(':memory:', migrations)
  close = db.close
  return new SessionStore(db.db)
}

const session = (id: string, title: string, updatedAt: number): SessionSummary => ({
  id,
  title,
  agent: 'assistant',
  kernel: 'opencode',
  workdir: '/w',
  model: '',
  permissionMode: 'ask',
  status: 'done',
  turns: 1,
  createdAt: updatedAt,
  updatedAt,
  lastError: null,
  pinnedAt: null,
})

const message = (sessionId: string, role: 'user' | 'assistant', text: string): MessageView => ({
  id: `${sessionId}-${role}`,
  sessionId,
  role,
  turn: 1,
  text,
  createdAt: 1,
  completedAt: 2,
  finishReason: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  contextTokens: 0,
})

function seed(store: SessionStore) {
  store.insertSession(session('a', '给兑换接口加幂等校验', 2))
  store.saveMessage(message('a', 'user', '给兑换接口加幂等校验，改完跑 tests/points'))
  store.saveMessage(message('a', 'assistant', ''))
  store.savePart({
    id: 'p1',
    messageId: 'a-assistant',
    sessionId: 'a',
    seq: 0,
    type: 'text',
    payload: { type: 'text', text: '已经加好了，tests/points 全部通过。' },
    status: null,
    createdAt: 3,
    updatedAt: 3,
  })
  store.insertSession(session('b', '排查订单退款超时', 1))
  store.saveMessage(message('b', 'user', '昨晚退款接口超时'))
  store.reindex('a')
  store.reindex('b')
}

const plain = (s: string | null | undefined) =>
  s?.replaceAll(HIT_OPEN, '[').replaceAll(HIT_CLOSE, ']')

describe('SessionStore.search', () => {
  it('finds words in the reply text and marks the hit', () => {
    const store = setup()
    seed(store)
    const hits = store.search('全部通过')
    expect(hits.map((h) => h.id)).toEqual(['a'])
    expect(plain(hits[0]?.snippet)).toContain('[全部通过]')
  })

  it('marks a title hit and leaves the snippet out when only the title matches', () => {
    const store = setup()
    seed(store)
    const [hit] = store.search('订单退款')
    expect(plain(hit?.title)).toBe('排查[订单退款]超时')
    expect(hit?.snippet).toBeNull()
  })

  it('falls back to LIKE for queries shorter than three characters', () => {
    const store = setup()
    seed(store)
    const hits = store.search('幂等')
    expect(hits.map((h) => h.id)).toEqual(['a'])
    expect(plain(hits[0]?.title)).toBe('给兑换接口加[幂等]校验')
  })

  it('needs every word to match', () => {
    const store = setup()
    seed(store)
    expect(store.search('退款 幂等')).toEqual([])
    expect(store.search('退款 超时').map((h) => h.id)).toEqual(['b'])
  })

  it('treats quotes and LIKE wildcards as plain text', () => {
    const store = setup()
    seed(store)
    expect(store.search('"x" OR')).toEqual([])
    expect(store.search('%')).toEqual([])
  })

  it('drops the index entry when the session is removed', () => {
    const store = setup()
    seed(store)
    store.remove('a')
    expect(store.session('a')).toBeUndefined()
    expect(store.search('全部通过')).toEqual([])
  })
})
