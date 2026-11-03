import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { writeGeneratedFiles } from '../generate/write'
import type {
  GeneratedFiles,
  KernelConfig,
  KernelDialect,
  KernelExit,
  SpawnedKernel,
} from '../kernel'

// OpenCode 方言：指定空闲端口启动 `opencode serve`，轮询 /global/health 等待就绪。
// 每次启动生成随机密码，服务端走 Basic Auth（用户名固定为 opencode），同机其他进程调不了内核接口。
// 配置目录通过环境变量注入；权限回复接口已对 1.19.5 实测确认（docs/references/model-poc.md）。

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

function openLog(file: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const stream = createWriteStream(file, { flags: 'a' })
  stream.write(`\n--- ${new Date().toISOString()} opencode serve ---\n`)
  return stream
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

// 子进程环境变量。XDG_*_HOME 全部指到 kits 的数据目录，内核就不碰用户家目录的 OpenCode 数据；
// OPENCODE_TEST_HOME 是 1.19.5 里 Global.Path.home 的唯一覆盖口（home = OPENCODE_TEST_HOME ?? os.homedir()），
// 配置查找会扫 {home}/.opencode，不设它用户的 ~/.opencode/opencode.json 还是会被加载；
// 三个 DISABLE 关掉自动更新、读 ~/.agents/skills 等外部技能、读 Claude Code 配置（PoC 里这两样每轮多 2.8k 输入 token，
// 还让内核行为依赖本机环境）；另外两个关掉从 models.dev 拉模型列表和自动下载 LSP，内网连不上，还会拖慢启动。
// cfg.env（网关 key 等）最后叠上，配置文件里用 `{env:…}` 引用。
// 只给子进程设，别 export 到当前 shell：XDG_DATA_HOME 会影响 fnm 之类的工具。
export function spawnEnv(
  cfg: KernelConfig,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return {
    ...base,
    OPENCODE_CONFIG_DIR: cfg.configDir,
    XDG_DATA_HOME: cfg.dataDir,
    XDG_CACHE_HOME: cfg.dataDir,
    XDG_CONFIG_HOME: cfg.dataDir,
    XDG_STATE_HOME: cfg.dataDir,
    OPENCODE_TEST_HOME: cfg.dataDir,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    ...cfg.env,
  }
}

export const opencodeDialect: KernelDialect = {
  id: 'opencode',
  apiPrefix: '',

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
      env: { ...spawnEnv(cfg), OPENCODE_SERVER_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    // 输出只在内存里留最后 64 KB（出错时给 tail 用），完整的写日志文件
    let stderr = ''
    const log = cfg.logFile ? openLog(cfg.logFile) : undefined
    const onOutput = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65_536)
      log?.write(chunk)
    }
    child.stderr?.on('data', onOutput)
    child.stdout?.on('data', onOutput)

    let closing = false
    const exitListeners: ((exit: KernelExit) => void)[] = []
    child.once('exit', (code, signal) => {
      log?.end()
      if (closing) return
      const exit = { code, signal, tail: tail(stderr) }
      for (const l of exitListeners) l(exit)
    })

    const close = async (): Promise<void> => {
      closing = true
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
    return { baseUrl, headers, close, onExit: (l) => void exitListeners.push(l) }
  },

  async writeConfig(dir: string, generated: GeneratedFiles): Promise<void> {
    await writeGeneratedFiles(dir, generated)
  },

  permissionReplyPath(requestId: string, _sessionId: string): string {
    return `/permission/${requestId}/reply`
  },
}
