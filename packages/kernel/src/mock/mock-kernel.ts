import type {
  AskUserInput,
  AskUserResult,
  KernelEvent,
  KitsToolContext,
  PermissionReply,
} from '@kits/core'
import type {
  AgentKernel,
  CreateSessionOptions,
  FileDiff,
  KernelExit,
  KernelMessage,
  KernelSession,
  UserInput,
} from '../kernel'
import { type MockScenario, type MockScenarioName, type MockStep, mockScenarios } from './scenarios'

// Mock 内核（phase1-implementation 4.4 节）：按场景回放事件，每步可带延迟。
// 权限请求真的等 respondPermission；ask_user / submit_output 走和真内核一样的 kits 工具处理函数，
// 所以会话服务和界面看到的流程和真内核一致。不起子进程、不调模型。

export interface MockKernelOptions {
  scenario: MockScenarioName | MockScenario
  // kits 工具的处理函数（主进程的工具宿主传进来）；不传时提问按不阻塞处理、产出直接丢掉
  tools?: {
    askUser(input: AskUserInput, ctx: KitsToolContext): Promise<AskUserResult>
    onOutput(output: unknown, ctx: KitsToolContext): Promise<void>
  }
  // 延迟倍数，E2E 用 0.1 之类加快
  speed?: number
}

const CHUNK = 12

// 会话 id 跨实例唯一：KernelManager 重启后会建新的 MockKernel，旧会话可能接着在新实例上跑
let nextSession = 0

export class MockKernel implements AgentKernel {
  readonly id = 'opencode' as const
  readonly capabilities = { subagents: false, revert: false }
  private readonly scenario: MockScenario
  // dispose 之后所有等待立刻结束，还没开始的等待也不再挂起
  private disposed = false
  private permissionWaiters = new Map<string, (reply: PermissionReply) => void>()
  // 回复可能在事件被消费方拿到、生成器还没往下走时就到了，先记下
  private earlyReplies = new Map<string, PermissionReply>()
  private aborted = new Set<string>()
  private abortWaiters = new Map<string, () => void>()
  private exitListeners: ((exit: KernelExit) => void)[] = []
  private started = false

  constructor(private readonly options: MockKernelOptions) {
    this.scenario =
      typeof options.scenario === 'string' ? mockScenarios[options.scenario] : options.scenario
  }

  async start(): Promise<void> {
    this.started = true
  }

  get running(): boolean {
    return this.started
  }

  async createSession(opts: CreateSessionOptions): Promise<KernelSession> {
    nextSession += 1
    return {
      id: `ses_mock_${nextSession}`,
      workdir: opts.workdir,
      agent: opts.agent,
      ...(opts.model ? { model: opts.model } : {}),
    }
  }

  // 等一段时间；中途 abort 了返回 false
  private wait(sessionId: string, ms: number): Promise<boolean> {
    const scaled = ms * (this.options.speed ?? 1)
    if (this.aborted.has(sessionId) || this.disposed) return Promise.resolve(false)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.abortWaiters.delete(sessionId)
        resolve(true)
      }, scaled)
      this.abortWaiters.set(sessionId, () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  async *prompt(session: KernelSession, _input: UserInput): AsyncIterable<KernelEvent> {
    this.aborted.delete(session.id)
    const ctx: KitsToolContext = { sessionId: session.id }
    const self = this
    async function* run(
      steps: MockStep[],
    ): AsyncGenerator<KernelEvent, 'ok' | 'aborted' | 'crashed'> {
      for (const step of steps) {
        if (!(await self.wait(session.id, step.delay ?? 50))) return 'aborted'
        if ('event' in step) {
          yield step.event
        } else if ('text' in step || 'reasoning' in step) {
          const full = 'text' in step ? step.text : step.reasoning
          for (let i = 0; i < full.length; i += CHUNK) {
            const text = full.slice(i, i + CHUNK)
            yield 'text' in step
              ? { type: 'text-delta', partId: step.partId, text }
              : { type: 'reasoning-delta', partId: step.partId, text }
            if (!(await self.wait(session.id, 30))) return 'aborted'
          }
        } else if ('tool' in step) {
          yield { type: 'tool-start', callId: step.callId, name: step.tool, input: step.input }
          if (!(await self.wait(session.id, 150))) return 'aborted'
          yield {
            type: 'tool-end',
            callId: step.callId,
            output: step.output,
            ...(step.error ? { error: step.error } : {}),
          }
        } else if ('permission' in step) {
          const p = step.permission
          yield { type: 'permission-request', ...p }
          const key = `${session.id}:${p.requestId}`
          const early = self.earlyReplies.get(key)
          self.earlyReplies.delete(key)
          const reply =
            self.aborted.has(session.id) || self.disposed
              ? 'aborted'
              : (early ??
                (await new Promise<PermissionReply | 'aborted'>((resolve) => {
                  self.permissionWaiters.set(key, resolve)
                  self.abortWaiters.set(session.id, () => resolve('aborted'))
                })))
          self.permissionWaiters.delete(key)
          if (reply === 'aborted') return 'aborted'
          const branch = yield* run(reply === 'reject' ? step.reject : step.allow)
          if (branch !== 'ok') return branch
        } else if ('ask' in step) {
          const input = { ...step.ask }
          yield { type: 'tool-start', callId: step.callId, name: 'kits_ask_user', input }
          // 消费方可能在拿到 tool-start 时就 abort 了，那时还没开始等
          if (self.aborted.has(session.id) || self.disposed) return 'aborted'
          const asked: Promise<AskUserResult> = self.options.tools
            ? self.options.tools.askUser(input, ctx)
            : Promise.resolve({
                answered: false,
                ...(input.assumption ? { assumption: input.assumption } : {}),
              })
          // 阻塞提问可能一直没人回答：abort / dispose 时不再等它
          const result = await Promise.race([
            asked,
            new Promise<'aborted'>((resolve) =>
              self.abortWaiters.set(session.id, () => resolve('aborted')),
            ),
          ])
          self.abortWaiters.delete(session.id)
          if (result === 'aborted' || self.aborted.has(session.id) || self.disposed)
            return 'aborted'
          yield { type: 'tool-end', callId: step.callId, output: JSON.stringify(result) }
        } else if ('output' in step) {
          yield {
            type: 'tool-start',
            callId: step.callId,
            name: 'kits_submit_output',
            input: { output: step.output },
          }
          await self.options.tools?.onOutput(step.output, ctx)
          yield { type: 'tool-end', callId: step.callId, output: '已提交' }
        } else if ('retry' in step) {
          yield { type: 'status', state: 'retry' }
          yield {
            type: 'retry',
            attempt: step.retry.attempt,
            message: step.retry.message,
            nextAt: Date.now() + step.retry.waitMs,
          }
          if (!(await self.wait(session.id, step.retry.waitMs))) return 'aborted'
          yield { type: 'status', state: 'busy' }
        } else if ('crash' in step) {
          // 先更新状态、通知退出，再交出 done：消费方拿到 done 就结束迭代时，这些也不会漏掉
          const exit = { code: 2, signal: null, tail: step.crash }
          self.started = false
          for (const l of self.exitListeners) l(exit)
          yield {
            type: 'done',
            reason: 'error',
            error: `内核进程退出了（退出码 2）\n${step.crash}`,
          }
          return 'crashed'
        }
      }
      return 'ok'
    }

    const result = yield* run(this.scenario.steps)
    if (result === 'crashed') return
    if (result === 'aborted') {
      yield { type: 'done', reason: 'aborted' }
      return
    }
    yield { type: 'status', state: 'idle' }
    yield { type: 'done', reason: 'completed' }
  }

  async respondPermission(
    session: KernelSession,
    requestId: string,
    reply: PermissionReply,
  ): Promise<void> {
    // 每个会话的场景都用同样的 requestId，按会话区分
    const key = `${session.id}:${requestId}`
    const waiter = this.permissionWaiters.get(key)
    if (waiter) waiter(reply)
    else this.earlyReplies.set(key, reply)
  }

  async abort(session: KernelSession): Promise<void> {
    this.aborted.add(session.id)
    this.abortWaiters.get(session.id)?.()
    this.abortWaiters.delete(session.id)
  }

  async diff(): Promise<FileDiff[]> {
    return this.scenario.diff ?? []
  }

  async summarize(): Promise<void> {}

  async messages(): Promise<KernelMessage[]> {
    return []
  }

  async revert(): Promise<void> {}

  onExit(listener: (exit: KernelExit) => void): void {
    this.exitListeners.push(listener)
  }

  async dispose(): Promise<void> {
    this.started = false
    this.disposed = true
    for (const waiter of this.abortWaiters.values()) waiter()
    this.abortWaiters.clear()
  }
}
