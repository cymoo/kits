import type { MessageView, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { mergeMessage, mergePart, mergeSession, replaySessionList } from './session-merge'

const session = {
  id: 's1',
  title: 't',
  agent: 'assistant',
  kernel: 'opencode' as const,
  workdir: '/w',
  model: 'corp/m',
  permissionMode: 'ask' as const,
  status: 'done' as const,
  turns: 1,
  createdAt: 0,
  updatedAt: 10,
  lastError: null,
  pinnedAt: null,
}
const message: MessageView = {
  id: 'a1',
  sessionId: 's1',
  role: 'assistant',
  turn: 1,
  text: '',
  createdAt: 1,
  completedAt: 9,
  finishReason: 'completed',
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  contextTokens: 0,
}
const part = (text: string, updatedAt: number): PartView => ({
  id: 'p1',
  messageId: 'a1',
  sessionId: 's1',
  seq: 0,
  type: 'text',
  payload: { type: 'text', text },
  status: null,
  createdAt: 1,
  updatedAt,
})
const snapshot: SessionDetail = {
  session,
  messages: [message],
  parts: [part('完整的正文', 8)],
  attachments: [],
}

describe('replaySessionList', () => {
  it('lets a push received during the list query win even with the same timestamp', () => {
    const fresh = [{ ...session, status: 'running' as const, updatedAt: 9 }]
    const pushes = [
      { ...session, status: 'done' as const, updatedAt: 9 },
      { ...session, id: 's2', updatedAt: 8 },
    ]
    expect(replaySessionList(fresh, pushes).map((s) => [s.id, s.status])).toEqual([
      ['s1', 'done'],
      ['s2', 'done'],
    ])
  })

  it('keeps the snapshot when nothing was pushed meanwhile', () => {
    expect(replaySessionList([{ ...session, updatedAt: 3 }], [])[0]?.updatedAt).toBe(3)
  })
})

describe('merging pushes into a snapshot', () => {
  it('skips a part update that is older than the snapshot', () => {
    expect(mergePart(part('完整', 5))(snapshot).parts[0]?.payload).toEqual({
      type: 'text',
      text: '完整的正文',
    })
  })

  it('applies a part update that is newer than the snapshot', () => {
    expect(mergePart(part('完整的正文，后面还有', 12))(snapshot).parts[0]?.updatedAt).toBe(12)
  })

  it('does not turn a finished message back into a running one', () => {
    const stale = { ...message, completedAt: null, finishReason: null }
    expect(mergeMessage(stale)(snapshot).messages[0]?.completedAt).toBe(9)
  })

  it('keeps the newer session summary', () => {
    expect(
      mergeSession({ ...session, status: 'running', updatedAt: 5 })(snapshot).session.status,
    ).toBe('done')
    expect(mergeSession({ ...session, title: '新', updatedAt: 11 })(snapshot).session.title).toBe(
      '新',
    )
  })
})
