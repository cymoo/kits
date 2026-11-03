import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { deriveBlocks, describeTool, patchTargets, permissionSubject } from './derive'

const session = {
  id: 's1',
  title: 't',
  agent: 'assistant',
  kernel: 'opencode' as const,
  workdir: '/repo/member-svc',
  model: 'corp/m',
  permissionMode: 'ask' as const,
  status: 'running' as const,
  turns: 1,
  createdAt: 0,
  updatedAt: 0,
  lastError: null,
}
const msg = (
  id: string,
  role: 'user' | 'assistant',
  extra: Partial<MessageView> = {},
): MessageView => ({
  id,
  sessionId: 's1',
  role,
  turn: 1,
  text: role === 'user' ? '加幂等校验' : '',
  createdAt: role === 'user' ? 1 : 2,
  completedAt: role === 'user' ? 1 : null,
  finishReason: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  contextTokens: 0,
  ...extra,
})
let seq = 0
const part = (payload: PartPayload, status: string | null = null, updatedAt = 3): PartView => ({
  id: `p${seq}`,
  messageId: 'a1',
  sessionId: 's1',
  seq: seq++,
  type: payload.type,
  payload,
  status,
  createdAt: 3,
  updatedAt,
})
const tool = (name: string, input: unknown, status = 'completed') =>
  part({ type: 'tool', callId: `c${seq}`, name, input }, status)

function detail(parts: PartView[], assistant: Partial<MessageView> = {}): SessionDetail {
  return { session, messages: [msg('u1', 'user'), msg('a1', 'assistant', assistant)], parts }
}

describe('deriveBlocks', () => {
  it('puts tools in the work process and the text after the last tool in the answer', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail(
        [
          part({ type: 'reasoning', text: '先看接口' }),
          part({ type: 'text', text: '我先读一下代码。' }),
          tool('read', { filePath: '/repo/member-svc/src/points/redeem.py' }),
          tool('edit', { filePath: '/repo/member-svc/src/points/redeem.py' }),
          part({ type: 'text', text: '改好了。' }),
        ],
        { completedAt: 9, finishReason: 'completed' },
      ),
      undefined,
      10,
    )
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'turn', 'text'])
    const turn = blocks[1]
    expect(turn?.kind === 'turn' && turn.steps.map((s) => [s.kind, s.detail])).toEqual([
      ['说明', '我先读一下代码。'],
      ['读取文件', 'src/points/redeem.py'],
      ['修改文件', 'src/points/redeem.py'],
    ])
    expect(turn).toMatchObject({ state: 'done', reasoning: '先看接口', filesChanged: 1 })
    expect(blocks[2]).toMatchObject({ text: '改好了。', streaming: false })
  })

  it('shows a waiting status line before the first part arrives', () => {
    const blocks = deriveBlocks(detail([]), undefined, 10)
    expect(blocks.at(-1)).toMatchObject({ kind: 'status', text: '等待模型回复' })
  })

  it('names the running tool in the status line after a quiet moment', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([tool('bash', { command: 'uv run pytest' }, 'running')]),
      undefined,
      3_000,
    )
    expect(blocks.at(-1)).toMatchObject({ kind: 'status', text: '正在执行命令：uv run pytest' })
  })

  it('shows retrying while the gateway retries', () => {
    const blocks = deriveBlocks(detail([]), { sessionId: 's1', state: 'retry', at: 5 }, 10)
    expect(blocks.at(-1)).toMatchObject({ text: '模型网关断开，正在重试' })
  })

  it('streams the answer without a status line while text keeps coming', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([part({ type: 'text', text: '正在' }, null, 9)]),
      undefined,
      10,
    )
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'text'])
    expect(blocks[1]).toMatchObject({ streaming: true })
  })

  it('adds an error block for a failed turn and marks the work process failed', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail(
        [tool('read', { filePath: 'a' }), part({ type: 'error', message: '内核进程退出了' })],
        {
          completedAt: 9,
          finishReason: 'error',
        },
      ),
    )
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'turn', 'error'])
    expect(blocks[1]).toMatchObject({ state: 'failed' })
  })
})

describe('describeTool', () => {
  it('names mcp tools by server and tool', () => {
    expect(
      describeTool({ type: 'tool', callId: 'c', name: 'wiki_get_page', input: {} }, '/w'),
    ).toEqual({
      kind: '调用平台',
      detail: 'wiki · get_page',
    })
  })
})

describe('deriveBlocks cards', () => {
  const perm = (status: string, callId?: string) =>
    part(
      {
        type: 'permission',
        requestId: 'per_1',
        tool: 'bash',
        input: { command: 'uv run pytest tests/points -q' },
        patterns: ['uv run pytest tests/points -q'],
        always: ['uv run pytest *'],
        ...(callId ? { callId } : {}),
      },
      status,
    )

  it('shows a pending permission as a card and hides the status line', () => {
    seq = 0
    const blocks = deriveBlocks(detail([perm('pending')]), undefined, 10_000)
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'permission'])
    expect(blocks[1]).toMatchObject({
      subject: 'uv run pytest tests/points -q',
      always: ['uv run pytest *'],
    })
  })

  it('marks the tool step with the reply once the permission is answered', () => {
    seq = 0
    const t = tool('bash', { command: 'uv run pytest' })
    const callId = t.payload.type === 'tool' ? t.payload.callId : ''
    const blocks = deriveBlocks(detail([t, perm('always', callId)]))
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.steps).toEqual([
      expect.objectContaining({ kind: '执行命令', meta: '本会话允许' }),
    ])
    expect(blocks.some((b) => b.kind === 'permission')).toBe(false)
  })

  it('shows a permission left unanswered when the app quit as expired, not allowed', () => {
    seq = 0
    const t = tool('bash', { command: 'uv run pytest' }, 'running')
    const callId = t.payload.type === 'tool' ? t.payload.callId : ''
    const blocks = deriveBlocks(
      detail([t, perm('expired', callId)], { completedAt: 5, finishReason: 'error' }),
    )
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.steps).toEqual([
      expect.objectContaining({ kind: '执行命令', meta: '已过期' }),
    ])
  })

  it('keeps a rejected permission without a tool step as a failed step', () => {
    seq = 0
    const blocks = deriveBlocks(detail([perm('reject')]))
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.steps[0]).toMatchObject({ state: 'error', meta: '已拒绝' })
  })

  it('shows a question card in place of the ask_user step', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([
        tool('kits_ask_user', { question: '哪个环境？' }, 'running'),
        part(
          {
            type: 'question',
            questionId: 'q1',
            question: '哪个环境？',
            options: ['测试', '预发'],
            blocking: true,
          },
          'pending',
        ),
      ]),
      undefined,
      10_000,
    )
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'question'])
    expect(blocks[1]).toMatchObject({ state: 'pending', options: ['测试', '预发'] })
  })

  it('shows the retry bar while the last part is a retry', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([part({ type: 'retry', attempt: 2, message: 'reset', nextAt: 9 })]),
      undefined,
      10_000,
    )
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'retry'])
  })

  it('drops the retry bar when an earlier text part keeps streaming after the retry', () => {
    seq = 0
    const text = part({ type: 'text', text: '接着' }, null, 9)
    const retry = part({ type: 'retry', attempt: 1, message: 'reset', nextAt: 9 }, null, 5)
    const blocks = deriveBlocks(detail([text, retry]))
    expect(blocks.some((b) => b.kind === 'retry')).toBe(false)
  })

  it('drops the retry bar once new content arrives', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([
        part({ type: 'retry', attempt: 2, message: 'reset', nextAt: 9 }),
        part({ type: 'text', text: '接着做' }),
      ]),
    )
    expect(blocks.some((b) => b.kind === 'retry')).toBe(false)
  })

  it('only lets the last turn continue after an error', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([part({ type: 'error', message: 'panic' })], {
        completedAt: 5,
        finishReason: 'error',
      }),
    )
    expect(blocks.at(-1)).toMatchObject({ kind: 'error', message: 'panic', last: true })
  })
})

describe('permissionSubject', () => {
  it('shows the command for bash, the relative path for edits and json otherwise', () => {
    expect(permissionSubject('bash', { command: 'ls' }, '/w')).toBe('ls')
    expect(permissionSubject('edit', { filePath: '/w/src/a.py' }, '/w')).toBe('src/a.py')
    expect(permissionSubject('req_get', { id: 'R-1' }, '/w')).toBe('{\n  "id": "R-1"\n}')
  })

  it('keeps long parameters whole instead of cutting them', () => {
    const body = 'x'.repeat(500)
    expect(permissionSubject('wiki_write', { body }, '/w')).toContain(body)
  })

  it('falls back to the request patterns when nothing else describes it', () => {
    expect(permissionSubject('bash', {}, '/w', ['rm -rf build'])).toBe('rm -rf build')
  })
})

describe('questions after the app quit', () => {
  it('keeps a non-blocking question answerable even if it was marked expired', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail(
        [
          part(
            {
              type: 'question',
              questionId: 'q',
              question: '用哪个库？',
              options: [],
              blocking: false,
            },
            'expired',
          ),
        ],
        { completedAt: 5, finishReason: 'error' },
      ),
    )
    expect(blocks.find((b) => b.kind === 'question')).toMatchObject({ state: 'pending' })
  })
})

describe('describeTool on windows paths', () => {
  it('shows paths relative to a backslash workdir whatever separator the kernel uses', () => {
    const p = (filePath: string) =>
      ({ type: 'tool', callId: 'c', name: 'read', input: { filePath } }) as const
    expect(describeTool(p('C:\\repo\\src\\a.ts'), 'C:\\repo').detail).toBe('src/a.ts')
    expect(describeTool(p('C:/repo/src/a.ts'), 'C:\\repo\\').detail).toBe('src/a.ts')
    expect(describeTool(p('D:\\other\\a.ts'), 'C:\\repo').detail).toBe('D:\\other\\a.ts')
  })
})

describe('apply_patch', () => {
  const patchText = [
    '*** Begin Patch',
    '*** Update File: /repo/member-svc/src/a.py',
    '@@',
    '-x',
    '+y',
    '*** Add File: src/b.py',
    '+z',
    '*** End Patch',
  ].join('\n')

  it('reads the target files from the patch text', () => {
    expect(patchTargets({ patchText }, '/repo/member-svc')).toEqual(['src/a.py', 'src/b.py'])
  })

  it('counts each patched file once in the work process', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([tool('apply_patch', { patchText }), tool('apply_patch', { patchText })], {
        completedAt: 5,
        finishReason: 'completed',
      }),
    )
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.filesChanged).toBe(2)
    expect(turn?.kind === 'turn' && turn.steps[0]?.detail).toBe('src/a.py, src/b.py')
  })
})
