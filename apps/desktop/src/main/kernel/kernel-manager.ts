import type { KernelName, KernelRuntime } from '@kits/core/ipc'
import type { AgentKernel, ConfigProblem, KernelConfig } from '@kits/kernel'

// KernelManager（phase1-implementation 5.1 节，关 #5）：
// - 每种内核一个 app 生命周期最多一个进程，第一次需要时懒启动，启动前生成并写配置；
// - 进程意外退出：正在跑的轮次已由适配器以 done: error 结束，这里把状态标成出错，下次 acquire 自动拉起；
// - 配置变更和手动重启：没有轮次在跑就立即重启，有的话标“待重启”，最后一轮结束后重启；启动途中改了配置，启动完再按同样规则处理；
// - 每种内核的启动、停止、重启排成一条队列依次执行，不会同时有两个进程用同一个数据目录；
// - 每次状态变化推给界面（设置页“内核与模型”卡片）。

export type PrepareResult =
  | { ok: true; cfg: KernelConfig }
  | { ok: false; problems: ConfigProblem[] }

export interface KernelManagerOptions {
  create(id: KernelName): AgentKernel
  // 生成并写配置，返回启动参数；配置不全时返回问题，不启动
  prepare(id: KernelName): Promise<PrepareResult>
  onStatus?(status: KernelRuntime): void
}

export class ConfigProblemsError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(problems.map((p) => p.message).join('；'))
    this.name = 'ConfigProblemsError'
  }
}

interface Slot {
  kernel: AgentKernel | undefined
  // 这个内核的生命周期操作队列
  lifecycle: Promise<unknown>
  starting: boolean
  // 启动途中配置又变了
  dirty: boolean
  runs: number
  status: KernelRuntime
  // 排在队列里、还没完成的那次取实例：同一批并发的 acquire 共用它（成功、失败都共用），
  // 启动失败不会被同一批请求串行重试 N 次
  pending: Promise<AgentKernel> | undefined
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class KernelManager {
  private slots = new Map<KernelName, Slot>()
  private closing = false

  constructor(private readonly options: KernelManagerOptions) {}

  private slot(id: KernelName): Slot {
    let slot = this.slots.get(id)
    if (!slot) {
      slot = {
        kernel: undefined,
        lifecycle: Promise.resolve(),
        starting: false,
        dirty: false,
        runs: 0,
        status: { id, state: 'stopped', error: null, problems: [] },
        pending: undefined,
      }
      this.slots.set(id, slot)
    }
    return slot
  }

  // 排进这个内核的队列，前一个操作结束（成功或失败）才开始
  private enqueue<T>(slot: Slot, op: () => Promise<T>): Promise<T> {
    const next = slot.lifecycle.then(op, op)
    slot.lifecycle = next.catch(() => {})
    return next
  }

  private setStatus(slot: Slot, patch: Partial<KernelRuntime>): void {
    slot.status = { ...slot.status, ...patch }
    this.options.onStatus?.(slot.status)
  }

  status(id: KernelName): KernelRuntime {
    return this.slot(id).status
  }

  // 拿到一个已启动的内核，并记一轮在跑；这一轮结束时调 release
  async acquire(id: KernelName): Promise<AgentKernel> {
    const slot = this.slot(id)
    slot.runs += 1
    try {
      return await this.ensure(id)
    } catch (e) {
      slot.runs -= 1
      throw e
    }
  }

  release(id: KernelName): void {
    const slot = this.slot(id)
    slot.runs = Math.max(0, slot.runs - 1)
    if (slot.runs === 0 && slot.status.state === 'restart-pending') void this.restart(id)
  }

  // 已有实例也排进队列再取：前面排着的重启会先把旧实例换掉，不会把要关掉的那个交出去
  private ensure(id: KernelName): Promise<AgentKernel> {
    if (this.closing) return Promise.reject(new Error('应用正在退出'))
    const slot = this.slot(id)
    if (slot.pending) return slot.pending
    const pending = this.enqueue(slot, async () => slot.kernel ?? this.start(id))
    slot.pending = pending
    const clear = () => {
      if (slot.pending === pending) slot.pending = undefined
    }
    pending.then(clear, clear)
    return pending
  }

  // 只在队列里调用
  private async start(id: KernelName): Promise<AgentKernel> {
    if (this.closing) throw new Error('应用正在退出')
    const slot = this.slot(id)
    slot.starting = true
    slot.dirty = false
    this.setStatus(slot, { state: 'starting', error: null, problems: [] })
    try {
      const prepared = await this.options.prepare(id)
      if (!prepared.ok) {
        this.setStatus(slot, { state: 'error', error: '配置不完整', problems: prepared.problems })
        throw new ConfigProblemsError(prepared.problems)
      }
      let kernel: AgentKernel
      try {
        kernel = this.options.create(id)
        await kernel.start(prepared.cfg)
      } catch (e) {
        this.setStatus(slot, { state: 'error', error: message(e) })
        throw e
      }
      kernel.onExit((exit) => {
        if (slot.kernel !== kernel) return
        slot.kernel = undefined
        const reason = exit.signal ? `信号 ${exit.signal}` : `退出码 ${exit.code}`
        this.setStatus(slot, { state: 'error', error: `内核进程退出了（${reason}）` })
      })
      // 启动途中应用开始退出了：这个进程不留
      if (this.closing) {
        await kernel.dispose()
        throw new Error('应用正在退出')
      }
      slot.kernel = kernel
      this.setStatus(slot, { state: 'running', error: null, problems: [] })
      // 启动途中配置又变了：现在用的是旧配置，按“有轮次在跑就等”的规则重启
      if (slot.dirty) this.markChanged(id, slot)
      return kernel
    } catch (e) {
      if (slot.status.state === 'starting')
        this.setStatus(slot, { state: 'error', error: message(e) })
      throw e
    } finally {
      slot.starting = false
    }
  }

  private markChanged(id: KernelName, slot: Slot): void {
    if (slot.runs > 0) this.setStatus(slot, { state: 'restart-pending' })
    else void this.restart(id)
  }

  // 设置、密钥、MCP、Agent、技能改了之后调用：内核要按新配置重启才生效
  configChanged(): void {
    for (const [id, slot] of this.slots) {
      if (slot.starting) {
        slot.dirty = true
        continue
      }
      if (slot.status.state === 'error' && !slot.kernel) {
        // 之前因为配置不全没起来的，清掉错误，下次用的时候重新生成
        this.setStatus(slot, { state: 'stopped', error: null, problems: [] })
        continue
      }
      if (slot.kernel) this.markChanged(id, slot)
    }
  }

  // 设置页点“重启”：有轮次在跑就标“待重启”，等最后一轮结束；直接关掉会让在跑的轮次收不到结束事件
  async requestRestart(id: KernelName): Promise<void> {
    const slot = this.slot(id)
    // 正在启动：记下重启意图（和启动途中改了配置一样），启动完再按“有轮次就等”的规则处理，不会被 running 状态盖掉
    if (slot.starting) {
      slot.dirty = true
      return
    }
    // 启动还排在队列里没开始：它会按现在的配置起，本身就是一次“重启”
    if (!slot.kernel && slot.pending) return
    if (slot.runs > 0) {
      this.setStatus(slot, { state: 'restart-pending' })
      return
    }
    await this.restart(id)
  }

  async restart(id: KernelName): Promise<void> {
    const slot = this.slot(id)
    // 重启排在后面：之后的 acquire 要等重启完再取，不能共用重启前那次
    slot.pending = undefined
    await this.enqueue(slot, async () => {
      const old = slot.kernel
      slot.kernel = undefined
      await old?.dispose()
      this.setStatus(slot, { state: 'stopped', error: null, problems: [] })
    })
    await this.ensure(id).catch(() => {
      // 错误已经写进状态
    })
  }

  async dispose(): Promise<void> {
    this.closing = true
    for (const slot of this.slots.values()) {
      // 等在途的启动 / 重启做完，再关掉它们留下的进程
      await slot.lifecycle
      const kernel = slot.kernel
      slot.kernel = undefined
      await kernel?.dispose()
    }
  }
}
