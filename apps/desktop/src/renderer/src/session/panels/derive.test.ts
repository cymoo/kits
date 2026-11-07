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

describe('deriveRounds without a kernel diff', () => {
  const edit = (
    messageId: string,
    callId: string,
    files: NonNullable<Extract<PartPayload, { type: 'tool' }>['files']>,
    name = 'edit',
  ) =>
    part(
      messageId,
      { type: 'tool', callId, name, input: { filePath: files[0]?.path }, files },
      'completed',
    )
  const change = (path: string, patch: string, status: 'added' | 'modified' = 'modified') => ({
    path: `/repo/member-svc/${path}`,
    status,
    additions: 1,
    deletions: 1,
    patch,
  })

  it('keeps the files of a finished turn when the kernel gave no diff for it', () => {
    seq = 0
    const rounds = deriveRounds(
      detail([msg('a1', 1)], [edit('a1', 'x', [change('a.py', '@@ -1 +1 @@\n-a\n+b\n')])]),
      [],
    )
    expect(rounds).toEqual([
      expect.objectContaining({
        turn: 1,
        pending: false,
        additions: 1,
        deletions: 1,
        files: [
          expect.objectContaining({ path: 'a.py', badge: 'M', patch: '@@ -1 +1 @@\n-a\n+b\n' }),
        ],
      }),
    ])
  })

  it('prefers the kernel diff of a turn over the diffs of its steps', () => {
    seq = 0
    const rounds = deriveRounds(
      detail([msg('a1', 1)], [edit('a1', 'x', [change('a.py', '@@ -1 +1 @@\n-a\n+b\n')])]),
      [{ turn: 1, path: 'a.py', status: 'modified', additions: 2, deletions: 2, patch: 'kernel' }],
    )
    expect(rounds[0]?.files).toEqual([expect.objectContaining({ patch: 'kernel', additions: 2 })])
  })

  it('joins the diffs of several edits to one file in a turn', () => {
    seq = 0
    const rounds = deriveRounds(
      detail(
        [msg('a1', 1)],
        [
          edit('a1', 'x', [change('a.py', '@@ -1 +1 @@\n-a\n+b\n', 'added')]),
          edit('a1', 'y', [change('a.py', '@@ -1 +1 @@\n-b\n+c\n')]),
        ],
      ),
      [],
    )
    expect(rounds[0]?.files).toEqual([
      expect.objectContaining({
        badge: 'A',
        additions: 2,
        patch: '@@ -1 +1 @@\n-a\n+b\n\n@@ -1 +1 @@\n-b\n+c\n',
      }),
    ])
  })

  it('drops a file created and then deleted in the same turn', () => {
    seq = 0
    const rounds = deriveRounds(
      detail(
        [msg('a1', 1)],
        [
          edit('a1', 'x', [change('tmp.py', '', 'added')], 'write'),
          edit('a1', 'y', [{ ...change('tmp.py', ''), status: 'deleted' }], 'apply_patch'),
        ],
      ),
      [],
    )
    expect(rounds).toEqual([])
  })

  it('marks a file overwritten by write as rewritten without a diff', () => {
    seq = 0
    const rounds = deriveRounds(
      detail([msg('a1', 1)], [edit('a1', 'x', [change('a.py', '')], 'write')]),
      [],
    )
    expect(rounds[0]?.files).toEqual([expect.objectContaining({ badge: 'M', rewrite: true })])
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
