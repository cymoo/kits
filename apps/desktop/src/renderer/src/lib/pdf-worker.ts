// PDF worker 的启动检查：pdfjs 拿到现成的 worker 时不等它就绪，worker 脚本加载失败也不报错，
// getDocument 会一直挂着。这里等 worker 发来第一条消息（pdfjs 的 worker 启动后先发 ready）再交给 pdfjs。

export const WORKER_TIMEOUT_MS = 10_000

type WorkerLike = Pick<Worker, 'addEventListener' | 'removeEventListener' | 'terminate'>

export function waitForWorker<T extends WorkerLike>(
  worker: T,
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const fail = (reason: string) => {
      done()
      worker.terminate()
      reject(new Error(reason))
    }
    const onMessage = () => {
      done()
      resolve(worker)
    }
    const onError = () => fail('PDF 组件没有启动')
    const timer = setTimeout(() => fail('PDF 组件启动超时'), timeoutMs)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
}
