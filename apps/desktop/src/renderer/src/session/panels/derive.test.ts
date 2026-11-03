import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { alwaysRules, deriveCommands, deriveRounds, deriveUsage, formatTokens } from './derive'

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
const bash = (
  messageId: string,
  command: string,
  extra: Partial<PartPayload> = {},
  status = 'completed',
) =>
  part(
    messageId,
    { type: 'tool', callId: `c${seq}`, name: 'bash', input: { command }, ...extra } as PartPayload,
    status,
  )
const detail = (messages: MessageView[], parts: PartView[]): SessionDetail => ({
  session,
  messages,
  parts,
})

describe('deriveRounds', () => {
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

describe('deriveCommands', () => {
  it('shows each command with its exit code, duration and how it was allowed', () => {
    seq = 0
    const ok = bash('a1', 'git status', { output: 'clean', exitCode: 0, durationMs: 120 })
    const failed = bash('a1', 'uv run pytest', { output: '1 failed', exitCode: 1 })
    const callId = failed.payload.type === 'tool' ? failed.payload.callId : ''
    const perm = part(
      'a1',
      {
        type: 'permission',
        requestId: 'per_1',
        tool: 'bash',
        input: {},
        patterns: [],
        always: ['uv run pytest *'],
        callId,
      },
      'always',
    )
    const commands = deriveCommands(detail([msg('a1', 1)], [ok, failed, perm]))
    expect(commands).toEqual([
      expect.objectContaining({
        command: 'git status',
        state: 'done',
        exitCode: 0,
        how: '自动允许',
      }),
      expect.objectContaining({
        command: 'uv run pytest',
        state: 'failed',
        exitCode: 1,
        how: '本会话允许',
      }),
    ])
    expect(alwaysRules(detail([msg('a1', 1)], [ok, failed, perm]))).toEqual(['uv run pytest *'])
  })

  it('marks a command still waiting for your confirmation', () => {
    seq = 0
    const t = bash('a1', 'rm -rf build', {}, 'running')
    const callId = t.payload.type === 'tool' ? t.payload.callId : ''
    const perm = part(
      'a1',
      {
        type: 'permission',
        requestId: 'p',
        tool: 'bash',
        input: {},
        patterns: [],
        always: [],
        callId,
      },
      'pending',
    )
    expect(deriveCommands(detail([msg('a1', 1)], [t, perm]))[0]).toMatchObject({
      state: 'waiting',
      how: '等待确认',
    })
  })

  it('drops the shell metadata opencode appends for the model', () => {
    seq = 0
    const t = bash('a1', 'ls', {
      output: 'a.py\nb.py\n\n<shell_metadata>\nexit 0\n</shell_metadata>\n',
    })
    expect(deriveCommands(detail([msg('a1', 1)], [t]))[0]?.output).toBe('a.py\nb.py')
  })
})

describe('deriveUsage', () => {
  it('takes the context size from the latest reply and adds up the totals', () => {
    const usage = deriveUsage(
      detail(
        [
          msg('a1', 1, {
            tokens: { input: 20_000, output: 300, cacheRead: 0, cacheWrite: 0 },
            cost: 0.1,
          }),
          msg('a2', 2, {
            tokens: { input: 5_000, output: 200, cacheRead: 30_000, cacheWrite: 0 },
            cost: 0.2,
          }),
        ],
        [],
      ),
    )
    expect(usage).toMatchObject({ context: 35_000, input: 25_000, output: 500, cacheRead: 30_000 })
    expect(usage.cost).toBeCloseTo(0.3)
  })

  it('formats token counts the way the prototype does', () => {
    expect([formatTokens(950), formatTokens(42_400), formatTokens(1_250_000)]).toEqual([
      '950',
      '42K',
      '1.3M',
    ])
  })
})
