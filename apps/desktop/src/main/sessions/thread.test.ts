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
  contextTokens: 0,
}

const recorder = () => {
  let t = 0
  return new TurnRecorder('s1', message, () => ++t)
}

describe('TurnRecorder', () => {
  it('places an interjection where the model saw it, after the steps that came first', () => {
    const r = recorder()
    const [note] = r.interject('q1', '先别改测试', [], 2).parts
    const [step] = r.apply({ type: 'tool-start', callId: 'c1', name: 'bash', input: {} }).parts
    const [sent] = r.apply({ type: 'interject-delivered' }).parts

    expect(note?.status).toBe('pending')
    expect(sent).toMatchObject({ id: note?.id, status: 'sent' })
    expect(sent?.seq).toBeGreaterThan(step?.seq ?? Number.POSITIVE_INFINITY)
  })

  it('keeps an interjection the model never saw when the turn ends', () => {
    const r = recorder()
    r.interject('q1', '先别改测试', [], 2)
    const { parts } = r.apply({ type: 'done', reason: 'aborted' })
    expect(parts.map((p) => p.status)).toEqual(['sent'])
  })

  it('takes the answer from the text after the last interjection', () => {
    const r = recorder()
    r.apply({ type: 'text-delta', partId: 't1', text: '先看看' })
    r.interject('q1', '先别改测试', [], 2)
    r.apply({ type: 'interject-delivered' })
    r.apply({ type: 'text-delta', partId: 't2', text: '好的' })
    expect(r.answerText()).toBe('好的')
  })

  it('keeps which task a subagent tool belongs to', () => {
    const r = recorder()
    const { parts } = r.apply({
      type: 'tool-start',
      callId: 't/c',
      parentCallId: 't',
      name: 'read',
      input: {},
    })
    expect(parts[0]?.payload).toMatchObject({ callId: 't/c', parentCallId: 't' })
  })

  it('marks a permission that came from a subagent', () => {
    const { parts } = recorder().apply({
      type: 'permission-request',
      requestId: 'r',
      tool: 'bash',
      input: {},
      patterns: [],
      always: [],
      subagent: true,
    })
    expect(parts[0]?.payload).toMatchObject({ subagent: true })
  })

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

  describe('a request the kernel settled by itself', () => {
    const asked = {
      type: 'permission-request' as const,
      tool: 'bash',
      input: {},
      patterns: ['ls'],
      always: ['ls *'],
    }

    it('takes the reply from the kernel and stops waiting', () => {
      const r = recorder()
      r.apply({ ...asked, requestId: 'per_1' })
      const change = r.apply({ type: 'permission-replied', requestId: 'per_1', reply: 'always' })
      expect(change.status).toBe('running')
      expect(change.parts[0]?.status).toBe('always')
    })

    it('keeps waiting while another request is pending', () => {
      const r = recorder()
      r.apply({ ...asked, requestId: 'per_1' })
      r.apply({ ...asked, requestId: 'per_2' })
      const change = r.apply({ type: 'permission-replied', requestId: 'per_1', reply: 'reject' })
      expect(change.status).toBe('waiting')
    })

    it('leaves a request the user already replied to alone', () => {
      const r = recorder()
      r.apply({ ...asked, requestId: 'per_1' })
      r.replyPermission('per_1', 'once')
      expect(r.expirePermission('per_1').parts).toEqual([])
    })

    it('expires a request that is gone from the kernel', () => {
      const r = recorder()
      r.apply({ ...asked, requestId: 'per_1' })
      const change = r.expirePermission('per_1')
      expect(change.status).toBe('running')
      expect(change.parts[0]?.status).toBe('expired')
    })
  })

  it('waits on a blocking question until it is answered', () => {
    const r = recorder()
    const asked = r.question('q1', { question: '哪个环境？', options: ['测试'], blocking: true })
    expect(asked.status).toBe('waiting')
    expect(asked.parts[0]).toMatchObject({ type: 'question', status: 'pending' })
    const answered = r.answer('q1', '测试')
    expect(answered.status).toBe('running')
    expect(answered.parts[0]).toMatchObject({ status: 'answered', payload: { answer: '测试' } })
  })

  it('does not wait on a non-blocking question', () => {
    const r = recorder()
    expect(r.question('q1', { question: '哪个环境？', blocking: false }).status).toBeUndefined()
  })

  it('stays waiting while a permission is still pending after a question is answered', () => {
    const r = recorder()
    r.apply({
      type: 'permission-request',
      requestId: 'per_1',
      tool: 'bash',
      input: {},
      patterns: [],
      always: [],
    })
    r.question('q1', { question: '哪个环境？', blocking: true })
    expect(r.answer('q1', '测试').status).toBe('waiting')
  })

  it('expires pending permissions and questions when the turn ends', () => {
    const r = recorder()
    r.question('q1', { question: '哪个环境？', blocking: true })
    const done = r.apply({ type: 'done', reason: 'aborted' })
    expect(done.parts).toEqual([expect.objectContaining({ type: 'question', status: 'expired' })])
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
