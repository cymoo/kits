import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForWorker } from './pdf-worker'

class FakeWorker extends EventTarget {
  terminated = false
  terminate() {
    this.terminated = true
  }
}

describe('waitForWorker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves once the worker sends its first message', async () => {
    const worker = new FakeWorker()
    const ready = waitForWorker(worker, 1000)
    worker.dispatchEvent(new Event('message'))
    await expect(ready).resolves.toBe(worker)
    expect(worker.terminated).toBe(false)
  })

  it('rejects and terminates when the worker script fails to load', async () => {
    const worker = new FakeWorker()
    const ready = waitForWorker(worker, 1000)
    worker.dispatchEvent(new Event('error'))
    await expect(ready).rejects.toThrow('PDF 组件没有启动')
    expect(worker.terminated).toBe(true)
  })

  it('rejects and terminates when the worker stays silent past the timeout', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const ready = waitForWorker(worker, 1000)
    const check = expect(ready).rejects.toThrow('PDF 组件启动超时')
    await vi.advanceTimersByTimeAsync(1000)
    await check
    expect(worker.terminated).toBe(true)
  })

  it('ignores errors after the worker is ready', async () => {
    const worker = new FakeWorker()
    const ready = waitForWorker(worker, 1000)
    worker.dispatchEvent(new Event('message'))
    await ready
    worker.dispatchEvent(new Event('error'))
    expect(worker.terminated).toBe(false)
  })
})
