import {
  type AskUserInput,
  type AskUserResult,
  type KernelEvent,
  type KitsToolContext,
  type PermissionReply,
  submitOutput,
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
    // 和真工具一样先按 Agent 的输出格式校验，不给就当没有输出格式
    outputSchema?(ctx: KitsToolContext): Record<string, unknown> | undefined
    onOutput(output: unknown, ctx: KitsToolContext): Promise<void>
  }
  // 延迟倍数，E2E 用 0.1 之类加快
  speed?: number
}

const CHUNK = 12

// 会话 id 跨实例唯一：KernelManager 重启后会建新的 MockKernel，旧会话可能接着在新实例上跑
let nextSession = 0
// 权限请求 id 每次都不一样（场景里写的 per_1 加上序号）：上一轮迟到的回复不会放行下一轮的同名请求
let nextRequest = 0

export class MockKernel implements AgentKernel {
  readonly id = 'opencode' as const
  readonly capabilities = { subagents: false, revert: false }
  private readonly scenario: MockScenario
  // dispose 之后所有等待立刻结束，还没开始的等待也不再挂起
  private disposed = false
  // 模拟的进程崩溃是整个实例的事：所有在跑的轮次都以出错结束，退出只通知一次
  private crashed: string | undefined
  private permissionWaiters = new Map<string, (reply: PermissionReply) => void>()
  // 回复可能在事件被消费方拿到、生成器还没往下走时就到了，先记下
  private earlyReplies = new Map<string, PermissionReply>()
  // 已经发出、还没回复的权限请求；只有它们的回复会被接受（包括比等待者先到的）
  private issued = new Set<string>()
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
    if (this.stopped(sessionId)) return Promise.resolve(false)
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

  private stopped(sessionId: string): boolean {
    return this.aborted.has(sessionId) || this.disposed || this.crashed !== undefined
  }

  private crash(tail: string): void {
    if (this.crashed !== undefined) return
    this.crashed = `内核进程退出了（退出码 2）\n${tail}`
    this.started = false
    for (const l of this.exitListeners) l({ code: 2, signal: null, tail })
    // 叫醒别的会话里还在等的轮次，让它们也结束
    for (const waiter of this.abortWaiters.values()) waiter()
    this.abortWaiters.clear()
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
          nextRequest += 1
          const p = { ...step.permission, requestId: `${step.permission.requestId}-${nextRequest}` }
          const key = `${session.id}:${p.requestId}`
          self.issued.add(key)
          yield { type: 'permission-request', ...p }
          const early = self.earlyReplies.get(key)
          self.earlyReplies.delete(key)
          const reply = self.stopped(session.id)
            ? 'aborted'
            : (early ??
              (await new Promise<PermissionReply | 'aborted'>((resolve) => {
                self.permissionWaiters.set(key, resolve)
                self.abortWaiters.set(session.id, () => resolve('aborted'))
              })))
          self.permissionWaiters.delete(key)
          self.earlyReplies.delete(key)
          self.issued.delete(key)
          if (reply === 'aborted') return 'aborted'
          const branch = yield* run(reply === 'reject' ? step.reject : step.allow)
          if (branch !== 'ok') return branch
        } else if ('ask' in step) {
          const input = { ...step.ask }
          yield { type: 'tool-start', callId: step.callId, name: 'kits_ask_user', input }
          // 消费方可能在拿到 tool-start 时就 abort 了，那时还没开始等
          if (self.stopped(session.id)) return 'aborted'
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
          if (result === 'aborted' || self.stopped(session.id)) return 'aborted'
          yield { type: 'tool-end', callId: step.callId, output: JSON.stringify(result) }
        } else if ('output' in step) {
          yield {
            type: 'tool-start',
            callId: step.callId,
            name: 'kits_submit_output',
            input: { output: step.output },
          }
          // 拿到 tool-start 就停了：已停止的轮次不再交产出
          if (self.stopped(session.id)) return 'aborted'
          const tools = self.options.tools
          const submitting = tools
            ? submitOutput(
                { outputSchema: (c) => tools.outputSchema?.(c), onOutput: tools.onOutput },
                step.output,
                ctx,
              )
            : Promise.resolve({ ok: true as const })
          // 处理函数可能一直不返回：abort / dispose 时不再等它，也不再报“已提交”
          const submitted = await Promise.race([
            submitting,
            new Promise<'aborted'>((resolve) =>
              self.abortWaiters.set(session.id, () => resolve('aborted')),
            ),
          ])
          self.abortWaiters.delete(session.id)
          if (submitted === 'aborted' || self.stopped(session.id)) return 'aborted'
          yield submitted.ok
            ? { type: 'tool-end', callId: step.callId, output: '已提交' }
            : { type: 'tool-end', callId: step.callId, output: null, error: submitted.error }
        } else if ('retry' in step) {
          yield { type: 'status', state: 'retry' }
          yield {
            type: 'retry',
            attempt: step.retry.attempt,
            message: step.retry.message,
            // 和实际等待一样按 speed 缩放，界面的倒计时才对得上
            nextAt: Date.now() + step.retry.waitMs * (self.options.speed ?? 1),
          }
          if (!(await self.wait(session.id, step.retry.waitMs))) return 'aborted'
          yield { type: 'status', state: 'busy' }
        } else if ('crash' in step) {
          // 先更新状态、通知退出，再交出 done：消费方拿到 done 就结束迭代时，这些也不会漏掉
          self.crash(step.crash)
          return 'crashed'
        }
      }
      return 'ok'
    }

    let result: 'ok' | 'aborted' | 'crashed'
    try {
      result = yield* run(this.scenario.steps)
    } catch (e) {
      // 注入的 askUser / onOutput 抛错：照接口约定以 done 结束
      this.abortWaiters.delete(session.id)
      yield { type: 'done', reason: 'error', error: e instanceof Error ? e.message : String(e) }
      return
    }
    if (this.crashed !== undefined) {
      yield { type: 'done', reason: 'error', error: this.crashed }
      return
    }
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
    const key = `${session.id}:${requestId}`
    // 不是正在等的请求（已经结束、被取消的轮次里的）：丢掉
    if (!this.issued.has(key)) return
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
