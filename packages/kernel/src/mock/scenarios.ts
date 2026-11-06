import type { AskUserInput, KernelEvent } from '@kits/core'
import type { FileDiff } from '../kernel'

// Mock 内核的场景（phase1-implementation 4.4 节），和原型 session.html 的 ?s= 一一对应。
// E2E（KITS_KERNEL=mock、KITS_MOCK_SCENARIO=<名字>）、界面开发和交付说明的验收步骤用。
// 写成 TS 而不是 JSON：步骤类型有检查，改场景时编译期就能发现写错的字段。

export type MockStep =
  | { delay?: number; event: KernelEvent }
  // 按块流出一段正文 / 思考
  | { delay?: number; text: string; partId: string }
  | { delay?: number; reasoning: string; partId: string }
  // 一次工具调用：start → end
  | {
      delay?: number
      tool: string
      callId: string
      parentCallId?: string
      input: unknown
      output: unknown
      error?: string
      exitCode?: number
      durationMs?: number
      additions?: number
      deletions?: number
      count?: number
    }
  // 权限请求：等 respondPermission，按回复走 allow 或 reject 分支
  | {
      delay?: number
      permission: {
        requestId: string
        tool: string
        input: unknown
        patterns: string[]
        always: string[]
        callId: string
        subagent?: boolean
      }
      allow: MockStep[]
      reject: MockStep[]
    }
  // 调 kits 的 ask_user：走和真内核一样的 askUser 处理函数，等它返回
  | { delay?: number; ask: AskUserInput; callId: string }
  // 调 kits 的 submit_output
  | { delay?: number; output: unknown; callId: string }
  // 网关断连重试：发 retry，等 waitMs 再回到 busy
  | { delay?: number; retry: { attempt: number; message: string; waitMs: number } }
  // 内核进程退出
  | { delay?: number; crash: string }

export interface MockScenario {
  name: MockScenarioName
  steps: MockStep[]
  diff?: FileDiff[]
}

export const mockScenarioNames = [
  'streaming',
  'permission',
  'permission-push',
  'question',
  'done',
  'retry',
  'crash',
  'context',
  'output-structured',
  'command-failed',
  'plan',
  'subagent',
  'plan',
] as const
export type MockScenarioName = (typeof mockScenarioNames)[number]

const busy: MockStep = { event: { type: 'status', state: 'busy' } }
const usage = (input: number, output: number): MockStep => ({
  event: {
    type: 'usage',
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  },
})

const planTodos = (first: string, second: string) => [
  { content: '读兑换接口', status: first, priority: 'high' },
  { content: '跑 tests/points', status: second, priority: 'medium' },
]

const readRedeem: MockStep = {
  delay: 300,
  tool: 'read',
  callId: 'call_read',
  input: { filePath: 'src/points/redeem.py' },
  output: 'def redeem(request_id, user_id, coupon_id):\n    ...',
  count: 86,
}

const redeemDiff: FileDiff = {
  path: 'src/points/redeem.py',
  status: 'modified',
  additions: 6,
  deletions: 1,
  patch: [
    '--- a/src/points/redeem.py',
    '+++ b/src/points/redeem.py',
    '@@ -1,2 +1,7 @@',
    '+from points.idempotent import idempotent',
    '+',
    '+',
    '+@idempotent(key="request_id")',
    ' def redeem(request_id, user_id, coupon_id):',
    '-    ...',
    '+    balance = get_balance(user_id)',
    '+    return exchange(balance, coupon_id)',
    '',
  ].join('\n'),
}

const editRedeem: MockStep = {
  delay: 300,
  tool: 'edit',
  callId: 'call_edit',
  input: { filePath: 'src/points/redeem.py' },
  output: 'Edit applied successfully.',
  additions: 6,
  deletions: 1,
}

const runTests: MockStep = {
  delay: 200,
  tool: 'bash',
  callId: 'call_test',
  input: { command: 'uv run pytest tests/points -q', description: '跑 points 的测试' },
  output: '............\n12 passed in 0.84s',
  exitCode: 0,
  durationMs: 1_200,
}

const answer =
  '改好了：把幂等检查抽成了装饰器 `@idempotent`，兑换接口加了一行。\n\n' +
  '| 文件 | 改动 |\n|---|---|\n| src/points/redeem.py | +6 −1 |\n\n跑一下 `tests/points` 确认没有回归。'

const failedTests: MockStep = {
  delay: 200,
  tool: 'bash',
  callId: 'call_fail',
  input: { command: 'uv run pytest tests/points -q', description: '跑 points 的测试' },
  output: [
    '.............F..                                                         [100%]',
    '=================================== FAILURES ===================================',
    '_______________ test_refund_same_request_id_returns_first_result _______________',
    '',
    '    def test_refund_same_request_id_returns_first_result():',
    '>       first = refund(order_id=1, amount=10, refund_request_id="r-1")',
    "E       TypeError: refund() got an unexpected keyword argument 'refund_request_id'",
    '',
    'tests/points/test_refund.py:90: TypeError',
    '------------------------------ Captured log call -------------------------------',
    'INFO     points.refund:refund.py:14 refund start order=1',
    '=========================== short test summary info ============================',
    'FAILED tests/points/test_refund.py::test_refund_same_request_id_returns_first_result',
    '1 failed, 15 passed in 0.91s',
  ].join('\n'),
  exitCode: 1,
  durationMs: 900,
}

export const mockScenarios: Record<MockScenarioName, MockScenario> = {
  done: {
    name: 'done',
    steps: [
      busy,
      {
        delay: 200,
        reasoning: '先看兑换接口现在怎么写的，再决定幂等检查放哪。',
        partId: 'prt_think',
      },
      readRedeem,
      editRedeem,
      runTests,
      { delay: 200, text: answer, partId: 'prt_answer' },
      usage(21_400, 320),
    ],
    diff: [redeemDiff],
  },
  'command-failed': {
    name: 'command-failed',
    steps: [
      busy,
      readRedeem,
      failedTests,
      {
        delay: 200,
        text: '有 1 个测试没过，`refund()` 还没接收请求号参数。',
        partId: 'prt_answer',
      },
      usage(9_800, 120),
    ],
  },
  streaming: {
    name: 'streaming',
    steps: [
      busy,
      {
        delay: 800,
        reasoning: '用户要给兑换接口加幂等校验。先读接口和测试，看请求号从哪来。',
        partId: 'prt_think',
      },
      { ...readRedeem, delay: 800 },
      { ...editRedeem, delay: 1_200 },
      { delay: 600, text: answer.repeat(3), partId: 'prt_answer' },
      usage(21_400, 980),
    ],
    diff: [redeemDiff],
  },
  'permission-push': {
    name: 'permission-push',
    steps: [
      busy,
      {
        delay: 200,
        event: {
          type: 'tool-start',
          callId: 'call_push',
          name: 'bash',
          input: { command: 'git push origin main', description: '推到远程' },
        },
      },
      {
        delay: 100,
        permission: {
          requestId: 'per_push',
          tool: 'bash',
          input: { command: 'git push origin main' },
          patterns: ['git push origin main'],
          always: ['git push *'],
          callId: 'call_push',
        },
        allow: [
          {
            delay: 200,
            event: { type: 'tool-end', callId: 'call_push', output: 'main -> main', exitCode: 0 },
          },
          { delay: 100, text: '推好了。', partId: 'prt_pushed' },
        ],
        reject: [
          {
            event: {
              type: 'tool-end',
              callId: 'call_push',
              output: null,
              error: '用户拒绝了这条命令',
            },
          },
        ],
      },
    ],
  },
  permission: {
    name: 'permission',
    steps: [
      busy,
      { delay: 200, text: '改完了，跑一下 points 的测试。', partId: 'prt_intro' },
      {
        delay: 200,
        event: {
          type: 'tool-start',
          callId: 'call_bash',
          name: 'bash',
          input: { command: 'uv run pytest tests/points -q', description: '跑 points 的测试' },
        },
      },
      {
        delay: 100,
        permission: {
          requestId: 'per_1',
          tool: 'bash',
          input: { command: 'uv run pytest tests/points -q' },
          patterns: ['uv run pytest tests/points -q'],
          always: ['uv run pytest *'],
          callId: 'call_bash',
        },
        allow: [
          {
            delay: 500,
            event: {
              type: 'tool-end',
              callId: 'call_bash',
              output: '12 passed in 3.41s',
              title: 'uv run pytest tests/points -q',
              exitCode: 0,
              durationMs: 3_410,
            },
          },
          { delay: 200, text: '12 个测试全部通过。', partId: 'prt_after' },
        ],
        reject: [
          {
            event: {
              type: 'tool-end',
              callId: 'call_bash',
              output: null,
              error: '用户拒绝了这条命令',
            },
          },
          {
            delay: 200,
            text: '好的，不跑测试了。需要的话你可以自己跑 `uv run pytest tests/points`。',
            partId: 'prt_after',
          },
        ],
      },
      usage(18_200, 140),
    ],
  },
  question: {
    name: 'question',
    steps: [
      busy,
      { delay: 200, text: '退款超时有两种可能，先确认一下环境。', partId: 'prt_intro' },
      {
        delay: 200,
        ask: {
          question: '在哪个环境复现的？',
          options: ['测试环境', '预发环境', '生产'],
          assumption: '测试环境',
          blocking: true,
        },
        callId: 'call_ask',
      },
      { delay: 300, text: '明白了，按这个环境查网关日志。', partId: 'prt_after' },
      usage(16_000, 90),
    ],
  },
  retry: {
    name: 'retry',
    steps: [
      busy,
      { delay: 300, retry: { attempt: 1, message: 'Connection reset by server', waitMs: 2_000 } },
      { delay: 200, text: '重试成功，接着做。', partId: 'prt_answer' },
      usage(10_700, 46),
    ],
  },
  crash: {
    name: 'crash',
    steps: [
      busy,
      { delay: 200, text: '文档已经写了前 6 个接口，', partId: 'prt_answer' },
      {
        delay: 300,
        crash: 'panic: runtime error: invalid memory address or nil pointer dereference',
      },
    ],
  },
  // 带计划的一轮：写计划 → 做 → 等确认时计划还在 → 更新计划 → 收尾
  plan: {
    name: 'plan',
    steps: [
      busy,
      {
        tool: 'todowrite',
        callId: 'call_plan_1',
        input: { todos: planTodos('in_progress', 'pending') },
        output: '[]',
      },
      readRedeem,
      {
        tool: 'todowrite',
        callId: 'call_plan_2',
        input: { todos: planTodos('completed', 'in_progress') },
        output: '[]',
      },
      {
        delay: 200,
        permission: {
          requestId: 'perm_plan',
          tool: 'bash',
          input: { command: 'uv run pytest tests/points -q' },
          patterns: ['uv run pytest tests/points -q'],
          always: ['uv run pytest *'],
          callId: 'call_plan_test',
        },
        allow: [
          {
            tool: 'todowrite',
            callId: 'call_plan_3',
            input: { todos: planTodos('completed', 'completed') },
            output: '[]',
          },
        ],
        reject: [],
      },
      { delay: 200, text: '都做完了。', partId: 'prt_answer' },
      usage(9_000, 120),
    ],
  },
  // 子任务里跑一条要确认的命令（真内核里这条请求来自子会话）
  subagent: {
    name: 'subagent',
    steps: [
      busy,
      {
        event: {
          type: 'tool-start',
          callId: 'call_task',
          name: 'task',
          input: {
            description: '跑 points 的测试',
            subagent_type: 'general',
            prompt: '跑 tests/points，把失败的用例列出来。',
          },
        },
      },
      {
        delay: 300,
        tool: 'read',
        callId: 'call_task/call_sub_read',
        parentCallId: 'call_task',
        input: { filePath: 'tests/points/conftest.py' },
        output: 'import pytest',
        count: 58,
      },
      {
        event: {
          type: 'tool-start',
          callId: 'call_task/call_sub_bash',
          parentCallId: 'call_task',
          name: 'bash',
          input: { command: 'git push origin points', description: '推上去' },
        },
      },
      {
        delay: 300,
        permission: {
          requestId: 'perm_sub',
          tool: 'bash',
          input: { command: 'git push origin points' },
          patterns: ['git push origin points'],
          always: ['git push *'],
          callId: 'call_task/call_sub_bash',
          subagent: true,
        },
        allow: [
          { event: { type: 'tool-end', callId: 'call_task/call_sub_bash', output: '' } },
          {
            event: {
              type: 'tool-end',
              callId: 'call_task',
              output:
                '<task id="ses_child" state="completed">\n<task_result>\n测试都过了\n</task_result>\n</task>',
              durationMs: 2_400,
            },
          },
        ],
        reject: [
          {
            event: {
              type: 'tool-end',
              callId: 'call_task/call_sub_bash',
              output: null,
              error: '被拒绝了',
            },
          },
          { event: { type: 'tool-end', callId: 'call_task', output: null, error: '被拒绝了' } },
        ],
      },
      { delay: 200, text: '子任务跑完了。', partId: 'prt_answer' },
      usage(9_000, 120),
    ],
  },
  context: {
    name: 'context',
    steps: [
      busy,
      { delay: 200, text: '第 30 天当天不降，第 31 天才会降。', partId: 'prt_answer' },
      // 128K 的 87%，界面应该出现压缩提示
      usage(111_400, 260),
    ],
  },
  'output-structured': {
    name: 'output-structured',
    steps: [
      busy,
      readRedeem,
      {
        delay: 300,
        output: {
          findings: [
            {
              api: 'POST /points/redeem',
              doc: 'request_id 可选',
              impl: 'request_id 必填',
              severity: 'high',
            },
            { api: 'GET /points/balance', doc: '返回整数', impl: '返回字符串', severity: 'low' },
          ],
        },
        callId: 'call_output',
      },
      { delay: 200, text: '找到 2 处不一致，1 处严重，已提交。', partId: 'prt_answer' },
      usage(24_000, 410),
    ],
  },
}
