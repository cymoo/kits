import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import type { GeneratedConfig, KernelConfig, KernelDialect, SpawnedKernel } from '../kernel'

// OpenCode 方言：指定空闲端口启动 `opencode serve`，轮询 /global/health 等待就绪。
// 配置目录通过环境变量注入；权限回复接口按锁定版本确定【待实测】。

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() =>
        typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port')),
      )
    })
  })
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`opencode exited with code ${child.exitCode}`)
    try {
      const res = await fetch(`${baseUrl}/global/health`)
      if (res.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('opencode did not become healthy in time')
}

export const opencodeDialect: KernelDialect = {
  id: 'opencode',

  async spawn(cfg: KernelConfig): Promise<SpawnedKernel> {
    const port = await freePort()
    const child = spawn(cfg.binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: cfg.configDir,
        OPENAI_BASE_URL: cfg.gateway.baseUrl,
        OPENAI_API_KEY: cfg.gateway.apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, child, 15_000)
    return {
      baseUrl,
      headers: {},
      async close() {
        if (child.exitCode === null) child.kill()
      },
    }
  },

  async writeConfig(_dir: string, _cfg: GeneratedConfig): Promise<void> {
    throw new Error('not implemented: 配置转换在第 2 周做')
  },

  permissionReplyPath(requestId: string, _sessionId: string): string {
    return `/permission/${requestId}/reply`
  },
}
