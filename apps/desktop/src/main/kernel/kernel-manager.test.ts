import type { KernelRuntime } from '@kits/core/ipc'
import type { AgentKernel, KernelExit } from '@kits/kernel'
import { describe, expect, it, vi } from 'vitest'
import { ConfigProblemsError, KernelManager, type PrepareResult } from './kernel-manager'

// 只实现 KernelManager 用到的几个方法
function fakeKernel() {
  let exit: ((e: KernelExit) => void) | undefined
  const kernel = {
    start: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    onExit: (l: (e: KernelExit) => void) => {
      exit = l
    },
  }
  return {
    kernel: kernel as unknown as AgentKernel,
    raw: kernel,
    crash: (e: KernelExit) => exit?.(e),
  }
}

const ok: PrepareResult = { ok: true, cfg: { binary: 'b', configDir: 'c', dataDir: 'd', env: {} } }

function setup(prepare: () => Promise<PrepareResult> = async () => ok) {
  const made: ReturnType<typeof fakeKernel>[] = []
  const states: KernelRuntime['state'][] = []
  const manager = new KernelManager({
    create: () => {
      const k = fakeKernel()
      made.push(k)
      return k.kernel
    },
    prepare,
    onStatus: (s) => states.push(s.state),
  })
  return { manager, made, states }
}

describe('KernelManager', () => {
  it('starts lazily and only once for concurrent callers', async () => {
    const { manager, made, states } = setup()
    expect(made).toHaveLength(0)
    const [a, b] = await Promise.all([manager.acquire('opencode'), manager.acquire('opencode')])
    expect(a).toBe(b)
    expect(made).toHaveLength(1)
    expect(states).toEqual(['starting', 'running'])
  })

  it('reports config problems and does not start the kernel', async () => {
    const problems = [{ section: 'model' as const, target: 'corp', message: '没有填 API Key' }]
    const { manager, made } = setup(async () => ({ ok: false, problems }))
    await expect(manager.acquire('opencode')).rejects.toBeInstanceOf(ConfigProblemsError)
    expect(made).toHaveLength(0)
    expect(manager.status('opencode')).toMatchObject({ state: 'error', problems })
  })

  it('marks an unexpected exit as error and starts a new process on the next acquire', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    manager.release('opencode')
    made[0]?.crash({ code: 1, signal: null, tail: 'boom' })
    expect(manager.status('opencode')).toMatchObject({
      state: 'error',
      error: '内核进程退出了（退出码 1）',
    })
    await manager.acquire('opencode')
    expect(made).toHaveLength(2)
    expect(manager.status('opencode').state).toBe('running')
  })

  it('restarts right away on a config change when nothing is running', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    manager.release('opencode')
    manager.configChanged()
    await vi.waitFor(() => expect(made).toHaveLength(2))
    expect(made[0]?.raw.dispose).toHaveBeenCalled()
  })

  it('waits for running turns before restarting on a config change', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    manager.configChanged()
    expect(manager.status('opencode').state).toBe('restart-pending')
    expect(made).toHaveLength(1)
    manager.release('opencode')
    await vi.waitFor(() => expect(made).toHaveLength(2))
    await vi.waitFor(() => expect(manager.status('opencode').state).toBe('running'))
  })

  it('clears a config error on change so the next acquire regenerates', async () => {
    let result: PrepareResult = {
      ok: false,
      problems: [{ section: 'model', target: 'x', message: 'm' }],
    }
    const { manager } = setup(async () => result)
    await expect(manager.acquire('opencode')).rejects.toThrow()
    result = ok
    manager.configChanged()
    expect(manager.status('opencode').state).toBe('stopped')
    await manager.acquire('opencode')
    expect(manager.status('opencode').state).toBe('running')
  })

  it('disposes every kernel', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    await manager.dispose()
    expect(made[0]?.raw.dispose).toHaveBeenCalled()
  })
})
