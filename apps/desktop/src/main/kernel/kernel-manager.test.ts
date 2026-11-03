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

  it('defers a manual restart until the running turns are released', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    await manager.requestRestart('opencode')
    expect(manager.status('opencode').state).toBe('restart-pending')
    expect(made[0]?.raw.dispose).not.toHaveBeenCalled()
    manager.release('opencode')
    await vi.waitFor(() => expect(made).toHaveLength(2))
    expect(made[0]?.raw.dispose).toHaveBeenCalled()
  })

  it('keeps a manual restart asked for while the kernel is still starting', async () => {
    let open = () => {}
    const gate = new Promise<void>((r) => {
      open = r
    })
    let preparing = false
    const { manager, made } = setup(async () => {
      preparing = true
      await gate
      return ok
    })
    const acquired = manager.acquire('opencode')
    // 已经在启动（prepare 在跑）时点重启
    await vi.waitFor(() => expect(preparing).toBe(true))
    await manager.requestRestart('opencode')
    open()
    await acquired
    // 启动完不是直接 running：还有一轮在跑，等它结束再重启
    expect(manager.status('opencode').state).toBe('restart-pending')
    manager.release('opencode')
    await vi.waitFor(() => expect(made).toHaveLength(2))
  })

  it('restarts right away on a manual restart when nothing is running', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    manager.release('opencode')
    await manager.requestRestart('opencode')
    expect(made).toHaveLength(2)
    expect(manager.status('opencode').state).toBe('running')
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

  it('shares one failed start between concurrent acquires and retries on a later one', async () => {
    const prepare = vi.fn(async (): Promise<PrepareResult> => {
      await new Promise((r) => setTimeout(r, 10))
      return { ok: false, problems: [{ section: 'model', target: 'x', message: 'm' }] }
    })
    const { manager } = setup(prepare)
    const all = await Promise.allSettled([
      manager.acquire('opencode'),
      manager.acquire('opencode'),
      manager.acquire('opencode'),
    ])
    expect(all.every((r) => r.status === 'rejected')).toBe(true)
    expect(prepare).toHaveBeenCalledTimes(1)
    await expect(manager.acquire('opencode')).rejects.toThrow()
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('disposes every kernel', async () => {
    const { manager, made } = setup()
    await manager.acquire('opencode')
    await manager.dispose()
    expect(made[0]?.raw.dispose).toHaveBeenCalled()
  })
})

describe('KernelManager lifecycle', () => {
  it('never runs two processes while a restart is shutting the old one down', async () => {
    let alive = 0
    let maxAlive = 0
    const manager = new KernelManager({
      create: () => {
        const kernel = {
          start: async () => {
            alive += 1
            maxAlive = Math.max(maxAlive, alive)
          },
          // 关得慢
          dispose: async () => {
            await new Promise((r) => setTimeout(r, 30))
            alive -= 1
          },
          onExit: () => {},
        }
        return kernel as unknown as AgentKernel
      },
      prepare: async () => ok,
    })
    const first = await manager.acquire('opencode')
    manager.release('opencode')
    const restart = manager.restart('opencode')
    const second = await manager.acquire('opencode')
    await restart
    expect(maxAlive).toBe(1)
    // 拿到的是重启后的新实例，不是马上要被关掉的旧实例
    expect(second).not.toBe(first)
    expect(manager.status('opencode').state).toBe('running')
  })

  it('restarts after starting when the config changed during the start', async () => {
    let release: () => void = () => {}
    let prepares = 0
    const { manager, made } = setup(async () => {
      prepares += 1
      if (prepares === 1) await new Promise<void>((r) => (release = r))
      return ok
    })
    const first = manager.acquire('opencode')
    await vi.waitFor(() => expect(prepares).toBe(1))
    manager.configChanged()
    release()
    await first
    // 第一轮还在跑：先标待重启
    expect(manager.status('opencode').state).toBe('restart-pending')
    manager.release('opencode')
    await vi.waitFor(() => expect(made).toHaveLength(2))
  })

  it('reports a factory error instead of staying in starting', async () => {
    const manager = new KernelManager({
      create: () => {
        throw new Error('CodeAgent 方言还没接入')
      },
      prepare: async () => ok,
    })
    await expect(manager.acquire('codeagent')).rejects.toThrow('CodeAgent')
    expect(manager.status('codeagent')).toMatchObject({
      state: 'error',
      error: 'CodeAgent 方言还没接入',
    })
  })

  it('cleans up a kernel that finishes starting after dispose began', async () => {
    let release: (() => void) | undefined
    const { manager, made } = setup(async () => {
      await new Promise<void>((r) => {
        release = r
      })
      return ok
    })
    const starting = manager.acquire('opencode').catch(() => {})
    // 等到真的在 prepare 里了再开始退出
    await vi.waitFor(() => expect(release).toBeDefined())
    const disposing = manager.dispose()
    release?.()
    await starting
    await disposing
    expect(made).toHaveLength(1)
    expect(made[0]?.raw.dispose).toHaveBeenCalled()
    await expect(manager.acquire('opencode')).rejects.toThrow('退出')
  })
})

describe('prepareKernelConfig', () => {
  it('reports an agent file it cannot load instead of falling back to the builtin agent', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { ConfigService } = await import('../config/config-service')
    const { prepareKernelConfig } = await import('./kernel-config')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kits-agents-'))
    mkdirSync(path.join(dir, 'agents'))
    writeFileSync(
      path.join(dir, 'agents', 'assistant.md'),
      '---\nname: assistant\noutput: missing.json\n---\n',
    )
    const result = prepareKernelConfig({
      config: new ConfigService({ dir }),
      secrets: { get: () => undefined } as never,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems[0]).toMatchObject({
      section: 'agent',
      target: 'assistant',
    })
  })
})
