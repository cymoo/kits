import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import {
  clipOutput,
  deriveBlocks,
  deriveTodos,
  describeTool,
  patchTargets,
  permissionSubject,
  todoProgress,
  todosOf,
} from './derive'

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
  pinnedAt: null,
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
  return {
    session,
    messages: [msg('u1', 'user'), msg('a1', 'assistant', assistant)],
    parts,
    attachments: [],
  }
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
    expect(turn?.kind === 'turn' && turn.steps.map((s) => [s.kind, s.desc ?? s.detail])).toEqual([
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
    ).toMatchObject({
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
      expect.objectContaining({ kind: '执行命令', foot: '本会话允许' }),
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

  it('offers to resend the task when the turn failed before reaching the kernel', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([part({ type: 'error', message: '配置不完整' })], {
        completedAt: 5,
        finishReason: 'error',
      }),
    )
    expect(blocks.at(-1)).toMatchObject({ kind: 'error', resend: '加幂等校验' })
  })

  it('keeps the retry bar when a question is answered during the retry', () => {
    seq = 0
    const q = part(
      {
        type: 'question',
        questionId: 'q',
        question: '?',
        options: [],
        blocking: false,
        answer: 'a',
      },
      'answered',
      20,
    )
    const retry = part({ type: 'retry', attempt: 1, message: 'reset', nextAt: 9 }, null, 10)
    const blocks = deriveBlocks(detail([{ ...q, createdAt: 2 }, retry]), undefined, 30_000)
    expect(blocks.some((b) => b.kind === 'retry')).toBe(true)
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

describe('tool steps', () => {
  type Tool = Extract<PartPayload, { type: 'tool' }>
  const step = (
    name: string,
    input: unknown,
    extra: Partial<Tool> = {},
    status = 'completed',
    assistant: Partial<MessageView> = { completedAt: 9, finishReason: 'completed' },
  ) => {
    seq = 0
    const p = part({ type: 'tool', callId: 'c', name, input, ...extra }, status)
    const turn = deriveBlocks(detail([p], assistant), undefined, 10).find((b) => b.kind === 'turn')
    if (turn?.kind !== 'turn') throw new Error('no turn')
    return turn.steps[0]
  }

  it('uses the description the model wrote as the title and keeps the command', () => {
    expect(step('bash', { command: 'git status', description: '看工作区' })).toMatchObject({
      desc: '看工作区',
      detail: 'git status',
    })
  })

  it('falls back to the command when the kernel gives no description', () => {
    const s = step('bash', { command: 'git status' })
    expect(s?.desc).toBeUndefined()
    expect(s).toMatchObject({ verb: '运行', detail: 'git status' })
  })

  it('shows how long a finished command took and how it was allowed', () => {
    expect(step('bash', { command: 'ls' }, { exitCode: 0, durationMs: 1_200 })).toMatchObject({
      state: 'done',
      meta: '1.2 秒',
      foot: '自动允许',
    })
  })

  it('marks a non-zero exit as failed even though the tool completed', () => {
    const s = step('bash', { command: 'pytest' }, { exitCode: 1, durationMs: 900 })
    expect(s).toMatchObject({
      state: 'error',
      failed: true,
      meta: '退出 1',
      foot: '0.9 秒 · 自动允许',
    })
  })

  it('counts failed steps on the turn', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail(
        [
          part({ type: 'tool', callId: 'a', name: 'bash', input: {}, exitCode: 2 }, 'completed'),
          part({ type: 'tool', callId: 'b', name: 'bash', input: {}, exitCode: 0 }, 'completed'),
          part({ type: 'tool', callId: 'c', name: 'read', input: {}, error: 'x' }, 'error'),
        ],
        { completedAt: 9, finishReason: 'completed' },
      ),
    )
    expect(blocks.find((b) => b.kind === 'turn')).toMatchObject({
      failed: 2,
      summary: { commands: 2, reads: 1 },
    })
  })

  it('does not count a rejected command as failed', () => {
    seq = 0
    const t = part({ type: 'tool', callId: 'c', name: 'bash', input: {}, error: 'no' }, 'error')
    const blocks = deriveBlocks(
      detail(
        [
          t,
          part(
            {
              type: 'permission',
              requestId: 'r',
              tool: 'bash',
              input: {},
              patterns: [],
              always: [],
              callId: 'c',
            },
            'reject',
          ),
        ],
        { completedAt: 9, finishReason: 'completed' },
      ),
    )
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn).toMatchObject({ failed: 0 })
    expect(turn?.kind === 'turn' && turn.steps[0]).toMatchObject({ state: 'error', meta: '已拒绝' })
  })

  it('marks a command still running when its turn ended as interrupted', () => {
    const s = step('bash', { command: 'sleep 100' }, {}, 'running')
    expect(s).toMatchObject({ state: 'error', meta: '中断' })
    expect(s?.failed).toBeUndefined()
  })

  it('times a running command from when it started', () => {
    const s = step('bash', { command: 'sleep 100' }, {}, 'running', {})
    expect(s).toMatchObject({ state: 'running', startedAt: 3 })
    expect(s?.meta).toBeUndefined()
  })

  it('shows a command waiting for your confirmation instead of a timer', () => {
    seq = 0
    const t = part({ type: 'tool', callId: 'c', name: 'bash', input: {} }, 'running')
    const asked = part(
      {
        type: 'permission',
        requestId: 'r',
        tool: 'bash',
        input: {},
        patterns: [],
        always: [],
        callId: 'c',
      },
      'pending',
    )
    const turn = deriveBlocks(detail([t, asked])).find((b) => b.kind === 'turn')
    const s = turn?.kind === 'turn' ? turn.steps[0] : undefined
    expect(s).toMatchObject({ state: 'running', meta: '等待确认' })
    expect(s?.startedAt).toBeUndefined()
  })

  it('drops the shell metadata opencode appends for the model', () => {
    const output = 'hi\n\n<shell_metadata>\nshell tool terminated\n</shell_metadata>\n'
    expect(step('bash', { command: 'ls' }, { output })?.output).toBe('hi')
  })

  it('shows the file content without the wrapper opencode adds for the model', () => {
    const output =
      '<path>/repo/member-svc/a.py</path>\n<type>file</type>\n<content>\n1: one\n2: two\n\n(End of file - total 2 lines)\n</content>'
    expect(step('read', { filePath: '/repo/member-svc/a.py' }, { output, count: 2 })).toMatchObject(
      {
        output: '1: one\n2: two',
        meta: '2 行',
      },
    )
  })

  it('shows search hits with paths relative to the workdir', () => {
    const output = 'Found 1 matches\n/repo/member-svc/a.py:\n  Line 2: two\n'
    expect(step('grep', { pattern: 'two' }, { output, count: 1 })).toMatchObject({
      output: 'a.py:\n  Line 2: two',
      meta: '1 处',
    })
  })

  it('shows glob results relative to the workdir', () => {
    const output = '/repo/member-svc/a.py\n/repo/member-svc/src/b.py'
    expect(step('glob', { pattern: '*' }, { output })?.output).toBe('a.py\nsrc/b.py')
  })

  it('leaves the workdir inside a matched line as it is', () => {
    const output =
      'Found 1 matches\n/repo/member-svc/a.py:\n  Line 2: ROOT = "/repo/member-svc/data"\n'
    expect(step('grep', { pattern: 'ROOT' }, { output })?.output).toBe(
      'a.py:\n  Line 2: ROOT = "/repo/member-svc/data"',
    )
  })

  it('leaves the workdir inside file content as it is', () => {
    const output = '<content>\n1: ROOT = "/repo/member-svc/data"\n</content>'
    expect(step('read', { filePath: '/repo/member-svc/a.py' }, { output })?.output).toBe(
      '1: ROOT = "/repo/member-svc/data"',
    )
  })

  it('leaves the workdir inside an mcp result as it is', () => {
    const output = '{"path":"/repo/member-svc/data"}'
    expect(step('wiki_get_page', {}, { output })?.output).toBe(output)
  })

  it('points an edit at the changes panel instead of expanding', () => {
    const s = step(
      'edit',
      { filePath: '/repo/member-svc/a.py' },
      { output: 'Edit applied successfully.', additions: 2, deletions: 1 },
    )
    expect(s).toMatchObject({ file: 'a.py', meta: '+2 −1', isStat: true })
    expect(s?.output).toBeUndefined()
  })

  it('counts the lines of a new file from its content', () => {
    expect(step('write', { filePath: '/repo/member-svc/a.py', content: 'a\nb\n' })).toMatchObject({
      file: 'a.py',
      meta: '+2',
    })
  })

  it('expands a failed edit to show the error', () => {
    const s = step('edit', { filePath: '/repo/member-svc/a.py' }, { error: 'no match' }, 'error')
    expect(s).toMatchObject({ failed: true, output: 'no match', meta: '失败' })
    expect(s?.file).toBeUndefined()
  })

  it('shows the arguments and the result of an mcp tool', () => {
    expect(step('wiki_get_page', { id: 1 }, { output: { title: 'a' } })).toMatchObject({
      args: '{\n  "id": 1\n}',
      output: '{\n  "title": "a"\n}',
    })
  })

  it('keeps the whole text of a multi-line note and titles it with the first line', () => {
    seq = 0
    const blocks = deriveBlocks(
      detail([
        part({ type: 'text', text: '先看代码。\n再改。' }),
        tool('read', { filePath: '/repo/member-svc/a.py' }),
      ]),
    )
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.steps[0]).toMatchObject({
      desc: '先看代码。',
      output: '先看代码。\n再改。',
    })
  })

  it('names a running command by its description in the status line', () => {
    seq = 0
    const p = part(
      { type: 'tool', callId: 'c', name: 'bash', input: { command: 'x', description: '跑测试' } },
      'running',
    )
    const blocks = deriveBlocks(detail([p]), undefined, 10_000)
    expect(blocks.at(-1)).toMatchObject({ kind: 'status', text: '正在执行命令：跑测试' })
  })
})

describe('clipOutput', () => {
  const text = Array.from({ length: 15 }, (_, i) => `l${i + 1}`).join('\n')

  it('keeps a short output whole', () => {
    expect(clipOutput('a\nb', 'tail')).toEqual({ text: 'a\nb', hidden: 0 })
  })

  it('keeps the end of a long command output', () => {
    const clip = clipOutput(text, 'tail', 12)
    expect(clip.hidden).toBe(3)
    expect(clip.text.startsWith('l4\n')).toBe(true)
    expect(clip.text.endsWith('l15')).toBe(true)
  })

  it('keeps the start of a long file', () => {
    const clip = clipOutput(text, 'head', 12)
    expect(clip.hidden).toBe(3)
    expect(clip.text.endsWith('l12')).toBe(true)
  })
})

describe('todos', () => {
  const plan = (...statuses: string[]) => ({
    todos: statuses.map((status, i) => ({ content: `第 ${i + 1} 项`, status, priority: 'high' })),
  })
  const detail = (parts: PartView[], messages = [msg('u1', 'user'), msg('a1', 'assistant')]) => ({
    session,
    messages,
    parts,
    attachments: [],
  })

  it('reads the todos of a todowrite call and skips malformed items', () => {
    expect(
      todosOf({ todos: [{ content: ' 读接口 ', status: 'done?' }, { status: 'pending' }, 3] }),
    ).toEqual([{ text: '读接口', status: 'pending' }])
    expect(todosOf({})).toEqual([])
  })

  it('leaves cancelled items out of the progress', () => {
    expect(todoProgress(todosOf(plan('completed', 'pending', 'cancelled')))).toBe('1/2')
  })

  it('shows a plan update as a step with the progress and the list instead of the json', () => {
    const blocks = deriveBlocks(
      detail([tool('todowrite', plan('completed', 'in_progress'))]),
      undefined,
      10,
    )
    const turn = blocks.find((b) => b.kind === 'turn')
    expect(turn?.kind === 'turn' && turn.steps[0]).toMatchObject({
      kind: '更新计划',
      meta: '1/2',
      todos: [
        { text: '第 1 项', status: 'completed' },
        { text: '第 2 项', status: 'in_progress' },
      ],
    })
    expect(turn?.kind === 'turn' && turn.steps[0]?.output).toBeUndefined()
  })

  it('takes the last plan of the running turn', () => {
    const items = deriveTodos(
      detail([tool('todowrite', plan('pending')), tool('todowrite', plan('completed'))]),
    )
    expect(items).toEqual([{ text: '第 1 项', status: 'completed' }])
  })

  it('has no plan card after the turn ended', () => {
    const ended = [msg('u1', 'user'), msg('a1', 'assistant', { completedAt: 9 })]
    expect(deriveTodos(detail([tool('todowrite', plan('pending'))], ended))).toEqual([])
  })
})

describe('subagents', () => {
  const detail = (parts: PartView[], messages = [msg('u1', 'user'), msg('a1', 'assistant')]) => ({
    session,
    messages,
    parts,
    attachments: [],
  })
  const task = (extra: object = {}, status = 'running') =>
    part(
      {
        type: 'tool',
        callId: 'call_t',
        name: 'task',
        input: { description: '探索仓库', prompt: '看看仓库', subagent_type: 'explore' },
        ...extra,
      },
      status,
    )
  const sub = (name: string, input: unknown, status = 'completed') =>
    part({ type: 'tool', callId: `call_t/${seq}`, parentCallId: 'call_t', name, input }, status)
  const turnOf = (d: ReturnType<typeof detail>, now = 10) => {
    const t = deriveBlocks(d, undefined, now).find((b) => b.kind === 'turn')
    if (t?.kind !== 'turn') throw new Error('no turn')
    return t
  }

  it('nests the tools of a subagent under its task step', () => {
    const t = turnOf(detail([task(), sub('read', { filePath: '/repo/member-svc/a.py' })]))
    expect(t.steps).toHaveLength(1)
    expect(t.steps[0]).toMatchObject({ kind: '子任务', detail: '探索仓库', prompt: '看看仓库' })
    expect(t.steps[0]?.subSteps?.map((s) => s.detail)).toEqual(['a.py'])
    expect(t.summary.tasks).toBe(1)
  })

  it('shows the task result without the kernel wrapper and counts the steps', () => {
    const output =
      '<task id="ses_1" state="completed">\n<task_result>\n结论\n</task_result>\n</task>'
    const t = turnOf(
      detail(
        [task({ output, durationMs: 65_000 }, 'completed'), sub('read', { filePath: 'a.py' })],
        [msg('u1', 'user'), msg('a1', 'assistant', { completedAt: 9, finishReason: 'completed' })],
      ),
    )
    expect(t.steps[0]).toMatchObject({ output: '结论', meta: '1 步 · 1:05' })
  })

  it('writes what the subagent is doing into the status line', () => {
    const blocks = deriveBlocks(
      detail([task(), sub('bash', { command: 'ls', description: '看目录' }, 'running')]),
      undefined,
      10_000,
    )
    expect(blocks.find((b) => b.kind === 'status')).toMatchObject({
      text: '正在子任务：探索仓库 · 运行 看目录',
    })
  })

  it('names the subtask on its permission card', () => {
    const blocks = deriveBlocks(
      detail([
        task(),
        part(
          {
            type: 'permission',
            requestId: 'r',
            tool: 'bash',
            input: { command: 'touch x' },
            patterns: ['touch x'],
            always: [],
            callId: 'call_t/call_c',
            subagent: true,
          },
          'pending',
        ),
      ]),
    )
    expect(blocks.find((b) => b.kind === 'permission')).toMatchObject({ subtask: '探索仓库' })
  })
})
