import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { alwaysRules, deriveRounds, deriveUsage, formatTokens } from './derive'

const session = {
  id: 's1',
  title: 't',
  agent: 'assistant',
  kernel: 'opencode' as const,
  workdir: '/repo/member-svc',
  model: 'corp/m',
  permissionMode: 'ask' as const,
  status: 'running' as const,
  turns: 2,
  createdAt: 0,
  updatedAt: 0,
  lastError: null,
  pinnedAt: null,
}
const msg = (id: string, turn: number, extra: Partial<MessageView> = {}): MessageView => ({
  id,
  sessionId: 's1',
  role: 'assistant',
  turn,
  text: '',
  createdAt: turn * 10,
  completedAt: turn * 10 + 5,
  finishReason: 'completed',
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  contextTokens: 0,
  ...extra,
})
let seq = 0
const part = (messageId: string, payload: PartPayload, status: string | null = null): PartView => ({
  id: `p${seq}`,
  messageId,
  sessionId: 's1',
  seq: seq++,
  type: payload.type,
  payload,
  status,
  createdAt: 0,
  updatedAt: 0,
})
const detail = (messages: MessageView[], parts: PartView[]): SessionDetail => ({
  session,
  messages,
  parts,
  attachments: [],
})

describe('deriveRounds', () => {
  it('titles a group with the first line of the message that asked for it', () => {
    const rounds = deriveRounds(
      detail([msg('u1', 1, { role: 'user', text: '  改退款接口\n顺便补测试' }), msg('a1', 1)], []),
      [{ turn: 1, path: 'a.py', status: 'added', additions: 1, deletions: 0, patch: '' }],
    )
    expect(rounds[0]?.title).toBe('改退款接口')
  })

  it('groups the stored diffs by turn with the latest turn first', () => {
    const rounds = deriveRounds(detail([msg('a1', 1), msg('a2', 2)], []), [
      { turn: 1, path: 'a.py', status: 'added', additions: 42, deletions: 0, patch: '' },
      { turn: 2, path: 'b.py', status: 'modified', additions: 3, deletions: 1, patch: '' },
      { turn: 2, path: 'c.py', status: 'modified', additions: 1, deletions: 0, patch: '' },
    ])
    expect(
      rounds.map((r) => [r.turn, r.files.map((f) => f.badge), r.additions, r.deletions]),
    ).toEqual([
      [2, ['M', 'M'], 4, 1],
      [1, ['A'], 42, 0],
    ])
  })

  it('lists the files edited so far in a running turn before the kernel has its diff', () => {
    seq = 0
    const running = msg('a2', 2, { completedAt: null, finishReason: null })
    const rounds = deriveRounds(
      detail(
        [msg('a1', 1), running],
        [
          part(
            'a2',
            {
              type: 'tool',
              callId: 'x',
              name: 'write',
              input: { filePath: '/repo/member-svc/new.py' },
            },
            'completed',
          ),
          part(
            'a2',
            {
              type: 'tool',
              callId: 'y',
              name: 'edit',
              input: { filePath: '/repo/member-svc/old.py' },
            },
            'completed',
          ),
          part(
            'a2',
            {
              type: 'tool',
              callId: 'z',
              name: 'edit',
              input: { filePath: '/repo/member-svc/wip.py' },
            },
            'running',
          ),
        ],
      ),
      [],
    )
    expect(rounds).toEqual([
      expect.objectContaining({
        turn: 2,
        pending: true,
        files: [
          expect.objectContaining({ path: 'new.py', badge: 'A' }),
          expect.objectContaining({ path: 'old.py', badge: 'M' }),
        ],
      }),
    ])
  })
})

describe('deriveRounds with apply_patch', () => {
  it('lists every file of a patch in a running turn with its operation', () => {
    seq = 0
    const running = msg('a1', 1, { completedAt: null, finishReason: null })
    const patchText = [
      '*** Begin Patch',
      '*** Add File: src/new.py',
      '*** Update File: /repo/member-svc/src/old.py',
      '*** Delete File: src/gone.py',
      '*** End Patch',
    ].join('\n')
    const rounds = deriveRounds(
      detail(
        [running],
        [
          part(
            'a1',
            { type: 'tool', callId: 'p', name: 'apply_patch', input: { patchText } },
            'completed',
          ),
        ],
      ),
      [],
    )
    expect(rounds[0]?.files.map((f) => [f.path, f.badge])).toEqual([
      ['src/new.py', 'A'],
      ['src/old.py', 'M'],
      ['src/gone.py', 'D'],
    ])
  })
})

describe('alwaysRules', () => {
  it('lists the rules of the permissions answered with allow for this session', () => {
    seq = 0
    const asked = (status: string, always: string[]) =>
      part(
        'a1',
        { type: 'permission', requestId: 'p', tool: 'bash', input: {}, patterns: [], always },
        status,
      )
    const parts = [asked('always', ['uv run pytest *']), asked('once', ['rm *'])]
    expect(alwaysRules(detail([msg('a1', 1)], parts))).toEqual(['uv run pytest *'])
  })
})

describe('deriveUsage', () => {
  it('takes the context size from the last model call and adds up the totals', () => {
    const tokens = (input: number, output: number, cacheRead: number) => ({
      input,
      output,
      cacheRead,
      cacheWrite: 0,
    })
    const usage = deriveUsage(
      detail(
        [
          // 一轮里两次调用，输入累计 90K；最后一次 50K 才是现在的上下文
          msg('a1', 1, { tokens: tokens(90_000, 300, 60_000), contextTokens: 50_000, cost: 0.1 }),
          msg('a2', 2, { completedAt: null, contextTokens: 0 }),
        ],
        [],
      ),
    )
    expect(usage).toMatchObject({ context: 50_000, input: 90_000, cacheRead: 60_000 })
    expect(usage.cost).toBeCloseTo(0.1)
  })

  it('formats token counts the way the prototype does', () => {
    expect([formatTokens(950), formatTokens(42_400), formatTokens(1_250_000)]).toEqual([
      '950',
      '42K',
      '1.3M',
    ])
  })
})
