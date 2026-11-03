import type { MessageView } from '@kits/core'
import { describe, expect, it } from 'vitest'
import { TurnRecorder } from './thread'

const message: MessageView = {
  id: 'm1',
  sessionId: 's1',
  role: 'assistant',
  turn: 1,
  text: '',
  createdAt: 0,
  completedAt: null,
  finishReason: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
}

const recorder = () => {
  let t = 0
  return new TurnRecorder('s1', message, () => ++t)
}

describe('TurnRecorder', () => {
  it('merges text deltas of one kernel part into one part', () => {
    const r = recorder()
    r.apply({ type: 'text-delta', partId: 'p1', text: '你' })
    const { parts } = r.apply({ type: 'text-delta', partId: 'p1', text: '好' })
    expect(parts).toEqual([
      expect.objectContaining({
        id: 'm1:text:p1',
        seq: 0,
        type: 'text',
        payload: { type: 'text', text: '你好' },
      }),
    ])
  })

  it('keeps reasoning and text apart and in order', () => {
    const r = recorder()
    const a = r.apply({ type: 'reasoning-delta', partId: 'p1', text: '想' })
    const b = r.apply({ type: 'text-delta', partId: 'p2', text: '答' })
    expect([a.parts[0]?.seq, b.parts[0]?.seq]).toEqual([0, 1])
    expect(a.parts[0]?.type).toBe('reasoning')
  })

  it('maps a tool call to one part that goes from running to completed', () => {
    const r = recorder()
    const start = r.apply({
      type: 'tool-start',
      callId: 'c1',
      name: 'read',
      input: { filePath: 'a.ts' },
    })
    expect(start.parts[0]).toMatchObject({ status: 'running', payload: { name: 'read' } })
    const end = r.apply({ type: 'tool-end', callId: 'c1', output: 'x', title: 'a.ts' })
    expect(end.parts[0]).toMatchObject({
      id: 'm1:tool:c1',
      seq: 0,
      status: 'completed',
      payload: { name: 'read', input: { filePath: 'a.ts' }, output: 'x', title: 'a.ts' },
    })
  })

  it('marks a failed tool as error', () => {
    const r = recorder()
    r.apply({ type: 'tool-start', callId: 'c1', name: 'bash', input: {} })
    expect(
      r.apply({ type: 'tool-end', callId: 'c1', output: null, error: 'boom' }).parts[0]?.status,
    ).toBe('error')
  })

  it('puts the session into waiting on a permission request and back to running after the reply', () => {
    const r = recorder()
    const asked = r.apply({
      type: 'permission-request',
      requestId: 'per_1',
      tool: 'bash',
      input: { command: 'ls' },
      patterns: ['ls'],
      always: ['ls *'],
    })
    expect(asked.status).toBe('waiting')
    expect(asked.parts[0]?.status).toBe('pending')
    const replied = r.replyPermission('per_1', 'once')
    expect(replied.status).toBe('running')
    expect(replied.parts[0]?.status).toBe('once')
  })

  it('adds up usage on the message', () => {
    const r = recorder()
    const usage = {
      type: 'usage',
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      cost: 0.5,
    } as const
    r.apply(usage)
    expect(r.apply(usage).message?.tokens).toEqual({
      input: 20,
      output: 4,
      cacheRead: 6,
      cacheWrite: 2,
    })
  })

  it('finishes the message and maps done reasons to session statuses', () => {
    expect(recorder().apply({ type: 'done', reason: 'completed' }).status).toBe('done')
    expect(recorder().apply({ type: 'done', reason: 'aborted' }).status).toBe('aborted')
    const failed = recorder().apply({ type: 'done', reason: 'error', error: '内核进程退出了' })
    expect(failed).toMatchObject({ status: 'error', error: '内核进程退出了' })
    expect(failed.parts[0]).toMatchObject({ type: 'error', payload: { message: '内核进程退出了' } })
    expect(failed.message?.finishReason).toBe('error')
  })
})
