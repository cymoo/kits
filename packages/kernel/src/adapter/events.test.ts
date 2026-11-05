import { describe, expect, it } from 'vitest'
import { createOpencodeEventMapper } from './events'
import { createSseParser } from './sse'

// 样本取自 docs/references/model-poc.md 的录制事件流（字段原样，id 缩短）
const S = 'ses_1'
const ev = (type: string, properties: Record<string, unknown>) => ({ type, properties })
const assistant = ev('message.updated', { sessionID: S, info: { id: 'msg_a', role: 'assistant' } })
const user = ev('message.updated', { sessionID: S, info: { id: 'msg_u', role: 'user' } })
const tool = (status: string, extra: Record<string, unknown> = {}) =>
  ev('message.part.updated', {
    sessionID: S,
    part: {
      id: 'prt_T',
      messageID: 'msg_a',
      sessionID: S,
      type: 'tool',
      tool: 'glob',
      callID: 'call_00',
      state: { status, ...extra },
    },
  })

function feed(events: unknown[]) {
  const m = createOpencodeEventMapper(S)
  return { mapper: m, out: events.flatMap((e) => m.map(e)) }
}

describe('createOpencodeEventMapper', () => {
  it('maps text deltas to text-delta with the part id', () => {
    const { out } = feed([
      assistant,
      ev('message.part.updated', {
        sessionID: S,
        part: { id: 'prt_X', messageID: 'msg_a', type: 'text', text: '' },
      }),
      ev('message.part.delta', {
        sessionID: S,
        messageID: 'msg_a',
        partID: 'prt_X',
        field: 'text',
        delta: '你好',
      }),
    ])
    expect(out).toEqual([{ type: 'text-delta', partId: 'prt_X', text: '你好' }])
  })

  it('maps deltas of a reasoning part to reasoning-delta', () => {
    const { out } = feed([
      assistant,
      ev('message.part.updated', {
        sessionID: S,
        part: { id: 'prt_R', messageID: 'msg_a', type: 'reasoning', text: '', time: { start: 1 } },
      }),
      ev('message.part.delta', {
        sessionID: S,
        messageID: 'msg_a',
        partID: 'prt_R',
        field: 'text',
        delta: 'Let',
      }),
    ])
    expect(out).toEqual([{ type: 'reasoning-delta', partId: 'prt_R', text: 'Let' }])
  })

  it('ignores text parts of the user message', () => {
    const { out } = feed([
      user,
      ev('message.part.updated', {
        sessionID: S,
        part: { id: 'prt_U', messageID: 'msg_u', type: 'text', text: '列出文件' },
      }),
    ])
    expect(out).toEqual([])
  })

  it('only emits the missing tail when a full text update follows deltas', () => {
    const { out } = feed([
      assistant,
      ev('message.part.delta', {
        sessionID: S,
        messageID: 'msg_a',
        partID: 'prt_X',
        field: 'text',
        delta: 'ab',
      }),
      ev('message.part.updated', {
        sessionID: S,
        part: { id: 'prt_X', messageID: 'msg_a', type: 'text', text: 'abc' },
      }),
      ev('message.part.updated', {
        sessionID: S,
        part: { id: 'prt_X', messageID: 'msg_a', type: 'text', text: 'abc' },
      }),
    ])
    expect(out.map((e) => e.type === 'text-delta' && e.text)).toEqual(['ab', 'c'])
  })

  it('waits for running before emitting tool-start with the input', () => {
    const { out } = feed([
      assistant,
      tool('pending', { input: {}, raw: '' }),
      tool('running', { input: { pattern: '**/*.ts' } }),
    ])
    expect(out).toEqual([
      { type: 'tool-start', callId: 'call_00', name: 'glob', input: { pattern: '**/*.ts' } },
    ])
  })

  it('maps a completed tool to tool-end with the output and title', () => {
    const { out } = feed([
      assistant,
      tool('running', { input: { pattern: '**/*.ts' } }),
      tool('completed', {
        input: { pattern: '**/*.ts' },
        output: 'a.ts\nb.ts',
        title: '<workdir>',
      }),
    ])
    expect(out[1]).toEqual({
      type: 'tool-end',
      callId: 'call_00',
      output: 'a.ts\nb.ts',
      title: '<workdir>',
    })
  })

  it('carries the exit code and duration of a finished command', () => {
    const { out } = feed([
      assistant,
      tool('running', { input: { command: 'ls' } }),
      tool('completed', {
        input: { command: 'ls' },
        output: 'a',
        metadata: { exit: 1, output: 'a' },
        time: { start: 1_000, end: 2_250 },
      }),
    ])
    expect(out[1]).toMatchObject({ type: 'tool-end', exitCode: 1, durationMs: 1_250 })
  })

  it.each([
    ['edit', { filediff: { additions: 2, deletions: 1 } }, { additions: 2, deletions: 1 }],
    ['grep', { matches: 7 }, { count: 7 }],
    ['glob', { count: 3 }, { count: 3 }],
    ['read', { display: { totalLines: 86 } }, { count: 86 }],
  ])('carries the numbers shown on a %s step', (tool, metadata, expected) => {
    const m = createOpencodeEventMapper('s1')
    const out = m.map({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'p1',
          messageID: 'a1',
          sessionID: 's1',
          type: 'tool',
          tool,
          callID: 'c1',
          state: { status: 'completed', input: {}, output: '', metadata },
        },
      },
    })
    expect(out[1]).toMatchObject({ type: 'tool-end', ...expected })
  })

  it('emits both start and end when a tool shows up already completed', () => {
    const { out } = feed([assistant, tool('completed', { input: { a: 1 }, output: 'x' })])
    expect(out.map((e) => e.type)).toEqual(['tool-start', 'tool-end'])
  })

  it('maps a failed tool to tool-end with the error', () => {
    const { out } = feed([
      assistant,
      tool('running', { input: {} }),
      tool('error', { error: 'rejected' }),
    ])
    expect(out[1]).toMatchObject({ type: 'tool-end', error: 'rejected' })
  })

  it('maps permission.replied so requests settled by the kernel do not stay pending', () => {
    const { out } = feed([
      ev('permission.replied', { sessionID: S, requestID: 'per_1', reply: 'always' }),
      ev('permission.replied', { sessionID: 'ses_other', requestID: 'per_2', reply: 'once' }),
    ])
    expect(out).toEqual([{ type: 'permission-replied', requestId: 'per_1', reply: 'always' }])
  })

  it('maps permission.asked with patterns, always and the call id', () => {
    const { out } = feed([
      ev('permission.asked', {
        id: 'per_1',
        sessionID: S,
        permission: 'bash',
        patterns: ['wc -l *.ts'],
        metadata: { command: 'wc -l *.ts' },
        always: ['wc *'],
        tool: { messageID: 'msg_a', callID: 'call_01' },
      }),
    ])
    expect(out).toEqual([
      {
        type: 'permission-request',
        requestId: 'per_1',
        tool: 'bash',
        input: { command: 'wc -l *.ts' },
        patterns: ['wc -l *.ts'],
        always: ['wc *'],
        callId: 'call_01',
      },
    ])
  })

  describe('subagent sessions', () => {
    const CHILD = 'ses_child'
    const created = ev('session.created', {
      sessionID: CHILD,
      info: { id: CHILD, parentID: S },
    })
    const asked = ev('permission.asked', {
      id: 'per_c',
      sessionID: CHILD,
      permission: 'bash',
      patterns: ['touch x'],
      metadata: { command: 'touch x' },
      always: ['touch *'],
      tool: { messageID: 'msg_c', callID: 'call_c' },
    })

    it('maps the reply to a permission request of a subagent session', () => {
      const replied = ev('permission.replied', {
        sessionID: CHILD,
        requestID: 'per_c',
        reply: 'reject',
      })
      expect(feed([created, replied]).out).toEqual([
        { type: 'permission-replied', requestId: 'per_c', reply: 'reject' },
      ])
    })

    it('surfaces a permission request of a subagent session', () => {
      const { out } = feed([created, asked])
      expect(out).toEqual([
        {
          type: 'permission-request',
          requestId: 'per_c',
          tool: 'bash',
          input: { command: 'touch x' },
          patterns: ['touch x'],
          always: ['touch *'],
          callId: 'call_c',
          subagent: true,
        },
      ])
    })

    const taskRunning = ev('message.part.updated', {
      sessionID: S,
      part: {
        id: 'prt_T',
        messageID: 'msg_a',
        sessionID: S,
        type: 'tool',
        tool: 'task',
        callID: 'call_t',
        state: { status: 'running', input: {}, metadata: { sessionId: CHILD } },
      },
    })
    const childTool = (status: string, extra: Record<string, unknown> = {}) =>
      ev('message.part.updated', {
        sessionID: CHILD,
        part: {
          id: 'prt_c',
          messageID: 'msg_c',
          sessionID: CHILD,
          type: 'tool',
          tool: 'read',
          callID: 'call_c',
          state: { status, input: { filePath: 'a.py' }, ...extra },
        },
      })

    it('maps the tools of a subagent under the task that started it', () => {
      const { out } = feed([
        assistant,
        created,
        taskRunning,
        childTool('running'),
        childTool('completed', { output: 'x' }),
      ])
      expect(out.slice(1)).toEqual([
        {
          type: 'tool-start',
          callId: 'call_t/call_c',
          parentCallId: 'call_t',
          name: 'read',
          input: { filePath: 'a.py' },
        },
        { type: 'tool-end', callId: 'call_t/call_c', output: 'x' },
      ])
    })

    it('points a subagent permission at the step of the subagent', () => {
      const { out } = feed([assistant, created, taskRunning, asked])
      expect(out.at(-1)).toMatchObject({ callId: 'call_t/call_c', subagent: true })
    })

    it('leaves text and usage of a subagent out of the turn', () => {
      const { out } = feed([
        assistant,
        created,
        taskRunning,
        ev('message.part.updated', {
          sessionID: CHILD,
          part: {
            id: 'prt_x',
            messageID: 'msg_c',
            sessionID: CHILD,
            type: 'text',
            text: '子任务说的',
          },
        }),
        ev('message.updated', {
          sessionID: CHILD,
          info: { id: 'msg_c', role: 'assistant', time: { completed: 1 }, tokens: { input: 9 } },
        }),
      ])
      expect(out.map((e) => e.type)).toEqual(['tool-start'])
    })

    it('learns the subagent session from the metadata of the task tool', () => {
      const task = ev('message.part.updated', {
        sessionID: S,
        part: {
          id: 'prt_T',
          messageID: 'msg_a',
          sessionID: S,
          type: 'tool',
          tool: 'task',
          callID: 'call_t',
          state: { status: 'running', input: {}, metadata: { sessionId: CHILD } },
        },
      })
      const { out } = feed([assistant, task, asked])
      expect(out.map((e) => e.type)).toEqual(['tool-start', 'permission-request'])
    })

    it('ignores a permission request of a session that is not ours', () => {
      const other = ev('session.created', {
        sessionID: 'ses_x',
        info: { id: 'ses_x', parentID: 'ses_other' },
      })
      const { out } = feed([
        other,
        { ...asked, properties: { ...asked.properties, sessionID: 'ses_x' } },
      ])
      expect(out).toEqual([])
    })

    it('does not end the turn when a subagent session goes idle', () => {
      const { mapper, out } = feed([created, ev('session.idle', { sessionID: CHILD })])
      expect(out).toEqual([])
      expect(mapper.done).toBe(false)
    })
  })

  it('accepts the CodeAgent permission.requested alias', () => {
    const { out } = feed([
      ev('permission.requested', { id: 'p', sessionID: S, permission: 'edit', metadata: {} }),
    ])
    expect(out[0]?.type).toBe('permission-request')
  })

  it('counts cache tokens into input on the completed assistant message once', () => {
    const done = ev('message.updated', {
      sessionID: S,
      info: {
        id: 'msg_a',
        role: 'assistant',
        cost: 0.01,
        tokens: { input: 100, output: 46, reasoning: 15, cache: { read: 20, write: 5 } },
        time: { created: 1, completed: 2 },
      },
    })
    const { out } = feed([done, done])
    expect(out).toEqual([
      {
        type: 'usage',
        inputTokens: 125,
        outputTokens: 46,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        cost: 0.01,
      },
    ])
  })

  it('maps a retry status to status and retry events, once per attempt', () => {
    const retry = ev('session.status', {
      sessionID: S,
      status: {
        type: 'retry',
        attempt: 1,
        message: 'Connection reset by server',
        next: 1793698818881,
      },
    })
    const { out } = feed([
      retry,
      retry,
      ev('session.status', { sessionID: S, status: { type: 'busy' } }),
    ])
    expect(out).toEqual([
      { type: 'status', state: 'retry' },
      { type: 'retry', attempt: 1, message: 'Connection reset by server', nextAt: 1793698818881 },
      { type: 'status', state: 'retry' },
      { type: 'status', state: 'busy' },
    ])
  })

  it('ends with completed on session.idle and ignores anything after', () => {
    const { out, mapper } = feed([
      ev('session.idle', { sessionID: S }),
      ev('session.error', { sessionID: S, error: { name: 'UnknownError' } }),
    ])
    expect(out).toEqual([{ type: 'done', reason: 'completed' }])
    expect(mapper.done).toBe(true)
  })

  it('ends with the error message on session.error', () => {
    const { out } = feed([
      ev('session.error', {
        sessionID: S,
        error: { name: 'UnknownError', data: { message: 'Invalid URL' } },
      }),
    ])
    expect(out).toEqual([{ type: 'done', reason: 'error', error: 'Invalid URL' }])
  })

  it('reports aborted after markAborted even when the kernel says idle', () => {
    const m = createOpencodeEventMapper(S)
    m.markAborted()
    expect(m.map(ev('session.idle', { sessionID: S }))).toEqual([
      { type: 'done', reason: 'aborted' },
    ])
  })

  it('maps MessageAbortedError to aborted', () => {
    const { out } = feed([
      ev('session.error', { sessionID: S, error: { name: 'MessageAbortedError' } }),
    ])
    expect(out).toEqual([{ type: 'done', reason: 'aborted' }])
  })

  it('ignores events of other sessions and noise events', () => {
    const { out } = feed([
      ev('session.idle', { sessionID: 'ses_other' }),
      ev('server.heartbeat', {}),
      ev('plugin.added', {}),
      ev('session.diff', { sessionID: S, diff: [] }),
    ])
    expect(out).toEqual([])
  })

  it('backfills only what was not emitted', () => {
    const m = createOpencodeEventMapper(S)
    m.map(assistant)
    m.map(
      ev('message.part.delta', {
        sessionID: S,
        messageID: 'msg_a',
        partID: 'prt_X',
        field: 'text',
        delta: 'ab',
      }),
    )
    const out = m.backfill([
      {
        info: { id: 'msg_a', role: 'assistant', time: { created: 100 } },
        parts: [
          { id: 'prt_X', messageID: 'msg_a', type: 'text', text: 'abcd' },
          {
            id: 'prt_T',
            messageID: 'msg_a',
            type: 'tool',
            tool: 'bash',
            callID: 'c',
            state: { status: 'completed', input: {}, output: 'ok' },
          },
        ],
      },
    ])
    expect(out.map((e) => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end'])
    expect(out[0]).toMatchObject({ text: 'cd' })
  })

  it('emits a recovered permission request once even if the live event also arrives', () => {
    const m = createOpencodeEventMapper(S)
    const asked = {
      id: 'per_9',
      sessionID: S,
      permission: 'bash',
      patterns: ['x'],
      metadata: {},
      always: [],
    }
    expect(m.permissions([asked])).toHaveLength(1)
    expect(m.map(ev('permission.asked', asked))).toEqual([])
    expect(m.permissions([{ ...asked, sessionID: 'ses_other' }])).toEqual([])
  })

  it('lets the adapter finish the turn only once', () => {
    const m = createOpencodeEventMapper(S)
    expect(m.finish('error', 'stuck')).toEqual([{ type: 'done', reason: 'error', error: 'stuck' }])
    expect(m.finish('completed')).toEqual([])
  })
})

describe('createSseParser', () => {
  it('joins data lines and splits events on blank lines across chunks', () => {
    const got: string[] = []
    const parse = createSseParser((d) => got.push(d))
    parse('data: {"a":')
    parse('1}\n\n: heartbeat\n\ndata: x\r\ndata: y\r\n\r\n')
    expect(got).toEqual(['{"a":1}', 'x\ny'])
  })

  it('keeps an event together when CRLF is split across chunks', () => {
    const got: string[] = []
    const parse = createSseParser((d) => got.push(d))
    parse('data: {"a":\r')
    parse('\ndata: 1}\r\n\r\n')
    expect(got).toEqual(['{"a":\n1}'])
  })
})

describe('CodeAgent events', () => {
  it('finishes on prompt.completed of this session only', () => {
    expect(feed([ev('prompt.completed', { sessionID: 'other' })]).out).toEqual([])
    expect(feed([ev('prompt.completed', { sessionID: S, status: 'completed' })]).out).toEqual([
      { type: 'done', reason: 'completed' },
    ])
  })

  it('maps prompt.failed to an error, or to aborted after abort', () => {
    const failed = ev('prompt.failed', { sessionID: S, error: { data: { message: '超时' } } })
    expect(feed([failed]).out).toEqual([{ type: 'done', reason: 'error', error: '超时' }])
    const m = createOpencodeEventMapper(S)
    m.markAborted()
    expect(m.map(failed)).toEqual([{ type: 'done', reason: 'aborted' }])
  })

  it('maps session.next.retried to a retry once', () => {
    const retried = ev('session.next.retried', {
      sessionID: S,
      attempt: 2,
      next: 1_000,
      error: { data: { message: 'gateway 503' } },
    })
    expect(feed([retried, retried]).out).toEqual([
      { type: 'status', state: 'retry' },
      { type: 'retry', attempt: 2, message: 'gateway 503', nextAt: 1_000 },
    ])
  })

  it('treats permission.requested like permission.asked', () => {
    const out = feed([
      ev('permission.requested', {
        id: 'per_1',
        sessionID: S,
        permission: 'bash',
        patterns: ['ls'],
      }),
    ]).out
    expect(out[0]).toMatchObject({ type: 'permission-request', requestId: 'per_1', tool: 'bash' })
  })
})
