import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { GeneratedConfig, KernelConfig, KernelDialect, SpawnedKernel } from '../kernel'

// OpenCode 方言：指定空闲端口启动 `opencode serve`，轮询 /global/health 等待就绪。
// 每次启动生成随机密码，服务端走 Basic Auth（用户名固定为 opencode），同机其他进程调不了内核接口。
// 配置目录通过环境变量注入；权限回复接口按锁定版本确定【待实测】。

const READY_TIMEOUT_MS = 30_000
const HEALTH_PROBE_TIMEOUT_MS = 2_000

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() =>
        typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port')),
      )
    })
  })
}

function tail(buf: string, lines = 20): string {
  return buf.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n')
}

async function waitForHealth(
  baseUrl: string,
  headers: Record<string, string>,
  child: ChildProcess,
  stderr: () => string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let spawnError: Error | undefined
  child.once('error', (e) => {
    spawnError = e
  })
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`failed to start opencode: ${spawnError.message}`)
    if (child.exitCode !== null) {
      throw new Error(`opencode exited with code ${child.exitCode}\n${tail(stderr())}`)
    }
    try {
      const res = await fetch(`${baseUrl}/global/health`, {
        headers,
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      })
      if (res.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`opencode did not become healthy within ${timeoutMs}ms\n${tail(stderr())}`)
}

export const opencodeDialect: KernelDialect = {
  id: 'opencode',

  async spawn(cfg: KernelConfig): Promise<SpawnedKernel> {
    const port = await freePort()
    const password = randomBytes(24).toString('base64url')
    const headers = {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    }
    const args = [
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
      '--print-logs',
      '--log-level',
      'WARN',
    ]
    const child = spawn(cfg.binary, args, {
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CONFIG_DIR: cfg.configDir,
        OPENAI_BASE_URL: cfg.gateway.baseUrl,
        OPENAI_API_KEY: cfg.gateway.apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const close = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill()
        // Windows 上 kill 是强杀，别的平台给 2 秒自己退
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          resolve()
        }, 2_000).unref()
      })
    }

    const baseUrl = `http://127.0.0.1:${port}`
    try {
      await waitForHealth(baseUrl, headers, child, () => stderr, READY_TIMEOUT_MS)
    } catch (e) {
      await close()
      throw e
    }
    return { baseUrl, headers, close }
  },

  async writeConfig(_dir: string, _cfg: GeneratedConfig): Promise<void> {
    throw new Error('not implemented: 配置转换在第 2 周做')
  },

  permissionReplyPath(requestId: string, _sessionId: string): string {
    return `/permission/${requestId}/reply`
  },
}
