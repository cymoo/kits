import type { KernelName, KernelRuntime } from '@kits/core/ipc'
import type { AgentKernel, ConfigProblem, KernelConfig } from '@kits/kernel'

// KernelManager（phase1-implementation 5.1 节，关 #5）：
// - 每种内核一个 app 生命周期最多一个进程，第一次需要时懒启动，启动前生成并写配置；
// - 进程意外退出：正在跑的轮次已由适配器以 done: error 结束，这里把状态标成出错，下次 acquire 自动拉起；
// - 配置变更：没有轮次在跑就立即重启，有的话标“待重启”，最后一轮结束后重启；
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
  starting: Promise<AgentKernel> | undefined
  runs: number
  status: KernelRuntime
}

export class KernelManager {
  private slots = new Map<KernelName, Slot>()

  constructor(private readonly options: KernelManagerOptions) {}

  private slot(id: KernelName): Slot {
    let slot = this.slots.get(id)
    if (!slot) {
      slot = {
        kernel: undefined,
        starting: undefined,
        runs: 0,
        status: { id, state: 'stopped', error: null, problems: [] },
      }
      this.slots.set(id, slot)
    }
    return slot
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

  private ensure(id: KernelName): Promise<AgentKernel> {
    const slot = this.slot(id)
    if (slot.kernel) return Promise.resolve(slot.kernel)
    slot.starting ??= this.start(id).finally(() => {
      slot.starting = undefined
    })
    return slot.starting
  }

  private async start(id: KernelName): Promise<AgentKernel> {
    const slot = this.slot(id)
    this.setStatus(slot, { state: 'starting', error: null, problems: [] })
    const prepared = await this.options.prepare(id).catch((e: unknown) => {
      this.setStatus(slot, { state: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    })
    if (!prepared.ok) {
      this.setStatus(slot, { state: 'error', error: '配置不完整', problems: prepared.problems })
      throw new ConfigProblemsError(prepared.problems)
    }
    const kernel = this.options.create(id)
    try {
      await kernel.start(prepared.cfg)
    } catch (e) {
      this.setStatus(slot, { state: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
    kernel.onExit((exit) => {
      if (slot.kernel !== kernel) return
      slot.kernel = undefined
      const reason = exit.signal ? `信号 ${exit.signal}` : `退出码 ${exit.code}`
      this.setStatus(slot, { state: 'error', error: `内核进程退出了（${reason}）` })
    })
    slot.kernel = kernel
    this.setStatus(slot, { state: 'running', error: null, problems: [] })
    return kernel
  }

  // 设置、MCP、Agent、技能改了之后调用：内核要按新配置重启才生效
  configChanged(): void {
    for (const [id, slot] of this.slots) {
      if (slot.status.state === 'error' && !slot.kernel) {
        // 之前因为配置不全没起来的，清掉错误，下次用的时候重新生成
        this.setStatus(slot, { state: 'stopped', error: null, problems: [] })
        continue
      }
      if (!slot.kernel) continue
      if (slot.runs > 0) this.setStatus(slot, { state: 'restart-pending' })
      else void this.restart(id)
    }
  }

  async restart(id: KernelName): Promise<void> {
    const slot = this.slot(id)
    await slot.starting?.catch(() => {})
    const old = slot.kernel
    slot.kernel = undefined
    await old?.dispose()
    this.setStatus(slot, { state: 'stopped', error: null, problems: [] })
    await this.ensure(id).catch(() => {
      // 错误已经写进状态
    })
  }

  async dispose(): Promise<void> {
    for (const slot of this.slots.values()) {
      const kernel = slot.kernel
      slot.kernel = undefined
      await kernel?.dispose()
    }
  }
}
