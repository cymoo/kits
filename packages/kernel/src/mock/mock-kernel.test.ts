import type { KernelEvent } from '@kits/core'
import { describe, expect, it } from 'vitest'
import type { KernelExit, KernelSession } from '../kernel'
import { MockKernel, type MockKernelOptions } from './mock-kernel'
import { mockScenarioNames } from './scenarios'

async function start(options: MockKernelOptions) {
  const kernel = new MockKernel({ speed: 0, ...options })
  await kernel.start()
  const session = await kernel.createSession({ workdir: '/w', agent: 'assistant', permission: [] })
  return { kernel, session }
}

async function collect(
  kernel: MockKernel,
  session: KernelSession,
  on?: (e: KernelEvent) => void | Promise<void>,
): Promise<KernelEvent[]> {
  const events: KernelEvent[] = []
  for await (const e of kernel.prompt(session, { text: 'hi' })) {
    events.push(e)
    await on?.(e)
  }
  return events
}

const text = (events: KernelEvent[]) =>
  events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')

describe('MockKernel', () => {
  it('ends every scenario with exactly one done', async () => {
    for (const scenario of mockScenarioNames) {
      const { kernel, session } = await start({
        scenario,
        tools: { askUser: async () => ({ answered: true, answer: 'x' }), onOutput: async () => {} },
      })
      const events = await collect(kernel, session, (e) =>
        e.type === 'permission-request'
          ? kernel.respondPermission(session, e.requestId, 'once')
          : undefined,
      )
      expect(
        events.filter((e) => e.type === 'done'),
        scenario,
      ).toHaveLength(1)
      expect(events.at(-1)?.type, scenario).toBe('done')
    }
  })

  it('waits for the permission reply and follows the allow branch', async () => {
    const { kernel, session } = await start({ scenario: 'permission' })
    const events = await collect(kernel, session, (e) =>
      e.type === 'permission-request'
        ? kernel.respondPermission(session, e.requestId, 'once')
        : undefined,
    )
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      output: '12 passed in 3.41s',
    })
    expect(text(events)).toContain('全部通过')
  })

  it('follows the reject branch when the user rejects', async () => {
    const { kernel, session } = await start({ scenario: 'permission' })
    const events = await collect(kernel, session, (e) =>
      e.type === 'permission-request'
        ? kernel.respondPermission(session, e.requestId, 'reject')
        : undefined,
    )
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({ error: '用户拒绝了这条命令' })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  })

  it('asks through the kits askUser handler with the session id', async () => {
    const asked: unknown[] = []
    const { kernel, session } = await start({
      scenario: 'question',
      tools: {
        askUser: async (input, ctx) => {
          asked.push([input.question, ctx.sessionId])
          return { answered: true, answer: '预发环境' }
        },
        onOutput: async () => {},
      },
    })
    const events = await collect(kernel, session)
    expect(asked).toEqual([['在哪个环境复现的？', session.id]])
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({
      output: expect.stringContaining('预发环境'),
    })
  })

  const findingsSchema = {
    type: 'object',
    required: ['findings'],
    properties: { findings: { type: 'array' } },
  }

  it('hands structured output that matches the schema to onOutput', async () => {
    const outputs: unknown[] = []
    const { kernel, session } = await start({
      scenario: 'output-structured',
      tools: {
        askUser: async () => ({ answered: false }),
        outputSchema: () => findingsSchema,
        onOutput: async (o) => void outputs.push(o),
      },
    })
    const events = await collect(kernel, session)
    expect(outputs).toHaveLength(1)
    expect(events.find((e) => e.type === 'tool-end' && e.callId === 'call_output')).toMatchObject({
      output: '已提交',
    })
  })

  it('rejects structured output without a schema or not matching it, like the real tool', async () => {
    for (const outputSchema of [() => undefined, () => ({ type: 'string' })]) {
      const outputs: unknown[] = []
      const { kernel, session } = await start({
        scenario: 'output-structured',
        tools: {
          askUser: async () => ({ answered: false }),
          outputSchema,
          onOutput: async (o) => void outputs.push(o),
        },
      })
      const events = await collect(kernel, session)
      expect(outputs).toHaveLength(0)
      expect(events.find((e) => e.type === 'tool-end' && e.callId === 'call_output')).toMatchObject(
        { error: expect.any(String) },
      )
    }
  })

  it('reports a crash as done error and notifies exit listeners', async () => {
    const { kernel, session } = await start({ scenario: 'crash' })
    const exits: KernelExit[] = []
    kernel.onExit((e) => exits.push(e))
    const events = await collect(kernel, session)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: expect.stringContaining('panic'),
    })
    expect(exits).toHaveLength(1)
  })

  it('notifies exit listeners before done so a consumer that stops at done sees the crash', async () => {
    const { kernel, session } = await start({ scenario: 'crash' })
    const exits: KernelExit[] = []
    kernel.onExit((e) => exits.push(e))
    for await (const e of kernel.prompt(session, { text: 'hi' })) if (e.type === 'done') break
    expect(exits).toHaveLength(1)
    expect(kernel.running).toBe(false)
  })

  it('gives sessions ids that stay unique across kernel instances', async () => {
    const a = await start({ scenario: 'done' })
    const b = await start({ scenario: 'done' })
    expect(a.session.id).not.toBe(b.session.id)
  })

  it('ends the turn when disposed right after a permission request was handed out', async () => {
    const { kernel, session } = await start({ scenario: 'permission' })
    const events = await collect(kernel, session, (e) =>
      e.type === 'permission-request' ? kernel.dispose() : undefined,
    )
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
  })

  it('stops with aborted while waiting for a permission reply', async () => {
    const { kernel, session } = await start({ scenario: 'permission' })
    const events = await collect(kernel, session, (e) =>
      e.type === 'permission-request' ? kernel.abort(session) : undefined,
    )
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
  })

  it('emits a retry with a future nextAt', async () => {
    const { kernel, session } = await start({ scenario: 'retry' })
    const before = Date.now()
    const events = await collect(kernel, session)
    const retry = events.find((e) => e.type === 'retry')
    expect(retry).toMatchObject({ attempt: 1, message: 'Connection reset by server' })
    expect(retry?.type === 'retry' && retry.nextAt).toBeGreaterThanOrEqual(before)
  })

  it('returns the scenario diff', async () => {
    const { kernel } = await start({ scenario: 'done' })
    expect((await kernel.diff())[0]?.path).toBe('src/points/redeem.py')
  })
  it('routes permission replies to the right session when both wait on the same request id', async () => {
    const kernel = new MockKernel({ scenario: 'permission', speed: 0 })
    await kernel.start()
    const a = await kernel.createSession({ workdir: '/w', agent: 'assistant', permission: [] })
    const b = await kernel.createSession({ workdir: '/w', agent: 'assistant', permission: [] })
    const run = (s: KernelSession, reply: 'once' | 'reject') =>
      collect(kernel, s, (e) =>
        e.type === 'permission-request'
          ? kernel.respondPermission(s, e.requestId, reply)
          : undefined,
      )
    const [ea, eb] = await Promise.all([run(a, 'once'), run(b, 'reject')])
    expect(ea.find((e) => e.type === 'tool-end')).toMatchObject({ output: '12 passed in 3.41s' })
    expect(eb.find((e) => e.type === 'tool-end')).toMatchObject({ error: '用户拒绝了这条命令' })
  })

  it('stops waiting for an unanswered blocking question on abort', async () => {
    let asked = () => {}
    const called = new Promise<void>((r) => {
      asked = r
    })
    const { kernel, session } = await start({
      scenario: 'question',
      tools: {
        askUser: () => {
          asked()
          return new Promise(() => {})
        },
        onOutput: async () => {},
      },
    })
    // 等 askUser 真的被调用（已经在等回答）再停
    void called.then(() => kernel.abort(session))
    const events = await collect(kernel, session)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
  })

  it('does not hand over output when the turn is stopped at the submit_output call', async () => {
    let outputs = 0
    const { kernel, session } = await start({
      scenario: 'output-structured',
      tools: {
        askUser: async () => ({ answered: false }),
        outputSchema: () => findingsSchema,
        onOutput: async () => {
          outputs += 1
        },
      },
    })
    const events = await collect(kernel, session, (e) =>
      e.type === 'tool-start' && e.name === 'kits_submit_output'
        ? kernel.abort(session)
        : undefined,
    )
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    expect(outputs).toBe(0)
  })

  it('ignores a late reply to a stopped turn so the next turn still waits', async () => {
    const { kernel, session } = await start({ scenario: 'permission' })
    let first = ''
    const stopped = await collect(kernel, session, async (e) => {
      if (e.type !== 'permission-request') return
      first = e.requestId
      await kernel.abort(session)
    })
    expect(stopped.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    // 上一轮的回复迟到了
    await kernel.respondPermission(session, first, 'once')
    let second = ''
    const seen: KernelEvent[] = []
    const next = await collect(kernel, session, async (e) => {
      seen.push(e)
      if (e.type !== 'permission-request') return
      second = e.requestId
      // 迟到的回复没有放行这一轮：它还停在确认上，回复了才继续
      await new Promise((r) => setTimeout(r, 20))
      expect(seen.some((x) => x.type === 'tool-end')).toBe(false)
      await kernel.respondPermission(session, e.requestId, 'reject')
    })
    expect(second).not.toBe(first)
    expect(next.find((e) => e.type === 'tool-end')).toMatchObject({ error: '用户拒绝了这条命令' })
  })

  it('stops waiting for an output handler that never returns on abort', async () => {
    let started = () => {}
    const called = new Promise<void>((r) => {
      started = r
    })
    const { kernel, session } = await start({
      scenario: 'output-structured',
      tools: {
        askUser: async () => ({ answered: false }),
        outputSchema: () => findingsSchema,
        onOutput: () => {
          started()
          return new Promise(() => {})
        },
      },
    })
    void called.then(() => kernel.abort(session))
    const events = await collect(kernel, session)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    expect(events.some((e) => e.type === 'tool-end' && e.callId === 'call_output')).toBe(false)
  })

  it('scales the retry countdown with the replay speed', async () => {
    const kernel = new MockKernel({ scenario: 'retry', speed: 0.1 })
    await kernel.start()
    const session = await kernel.createSession({
      workdir: '/w',
      agent: 'assistant',
      permission: [],
    })
    const before = Date.now()
    const events = await collect(kernel, session)
    const retry = events.find((e) => e.type === 'retry')
    // 场景里等 2 秒，0.1 倍速就是 200 ms
    expect(retry?.type === 'retry' && retry.nextAt - before).toBeLessThan(1_000)
  })

  it('ends every running turn when the simulated process crashes and notifies the exit once', async () => {
    const kernel = new MockKernel({
      speed: 0,
      scenario: {
        name: 'permission',
        steps: [
          {
            permission: {
              requestId: 'per_1',
              tool: 'bash',
              input: {},
              patterns: [],
              always: [],
              callId: 'c1',
            },
            allow: [{ crash: 'boom' }],
            reject: [],
          },
        ],
      },
    })
    await kernel.start()
    const opts = { workdir: '/w', agent: 'assistant', permission: [] }
    const a = await kernel.createSession(opts)
    const b = await kernel.createSession(opts)
    const exits: KernelExit[] = []
    kernel.onExit((e) => exits.push(e))
    const asked = { a: false, b: false }
    const both = Promise.all([
      collect(kernel, a, async (e) => {
        if (e.type !== 'permission-request') return
        asked.a = true
        while (!asked.b) await new Promise((r) => setTimeout(r, 5))
        await kernel.respondPermission(a, e.requestId, 'once')
      }),
      collect(kernel, b, (e) => {
        if (e.type === 'permission-request') asked.b = true
      }),
    ])
    const [ea, eb] = await both
    expect(ea.at(-1)).toMatchObject({ type: 'done', reason: 'error' })
    expect(eb.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: expect.stringContaining('boom'),
    })
    expect(exits).toHaveLength(1)
  })

  it('ends the turn with an error when an injected handler throws', async () => {
    const { kernel, session } = await start({
      scenario: 'question',
      tools: {
        askUser: async () => {
          throw new Error('保存失败')
        },
        onOutput: async () => {},
      },
    })
    const events = await collect(kernel, session)
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'error', error: '保存失败' })
  })
})
