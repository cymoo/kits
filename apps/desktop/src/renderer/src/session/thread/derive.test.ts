import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { deriveBlocks, describeTool } from './derive'

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

describe('describeTool on windows paths', () => {
  it('shows paths relative to a backslash workdir whatever separator the kernel uses', () => {
    const p = (filePath: string) =>
      ({ type: 'tool', callId: 'c', name: 'read', input: { filePath } }) as const
    expect(describeTool(p('C:\\repo\\src\\a.ts'), 'C:\\repo').detail).toBe('src/a.ts')
    expect(describeTool(p('C:/repo/src/a.ts'), 'C:\\repo\\').detail).toBe('src/a.ts')
    expect(describeTool(p('D:\\other\\a.ts'), 'C:\\repo').detail).toBe('D:\\other\\a.ts')
  })
})
