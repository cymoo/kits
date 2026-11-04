import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { CODEAGENT_CONFIG_FILE, resolveEnvRefs } from '../generate/codeagent-config'
import { writeGeneratedFiles } from '../generate/write'
import type {
  GeneratedFiles,
  KernelConfig,
  KernelDialect,
  KernelExit,
  SpawnedKernel,
} from '../kernel'
import { openLog, stopChild, tail } from './child'

// CodeAgent 方言（phase1-implementation 4.3 节，按 docs/references/codeagent-sdk.md 写，真机待验）：
// - `codeagent serve --port 0 --token <随机> --config-dir <目录>`，端口自己选，就绪时 stdout 打一行
//   `{"type":"codeagent.server.ready","base_url":…,"auth":{"token":…}}`；
// - 接口在 /api/v1 下，Bearer 鉴权；会话、消息、权限、事件的接口和 OpenCode 一样，差异在事件名（events.ts 归一）。
// - 配置文件名文档没写：写 codeagent.json，就绪后 GET /global/config 核对默认模型，没读到就 PATCH 补上。
// 子进程环境和 OpenCode 一样把家目录类的变量指到 kits 的数据目录，不读用户自己的 ~/.cac。

const READY_TIMEOUT_MS = 30_000
const READY_TYPE = 'codeagent.server.ready'

export interface ReadyLine {
  baseUrl: string
  token?: string
  version?: string
}

// stdout 里找就绪那一行（前后可能还有别的日志）
export function parseReadyLine(line: string): ReadyLine | undefined {
  const text = line.trim()
  if (!text.startsWith('{')) return undefined
  try {
    const v = JSON.parse(text) as {
      type?: string
      base_url?: string
      auth?: { token?: string }
      version?: string
    }
    if (v.type !== READY_TYPE || !v.base_url) return undefined
    return {
      baseUrl: v.base_url.replace(/\/+$/, ''),
      ...(v.auth?.token ? { token: v.auth.token } : {}),
      ...(v.version ? { version: v.version } : {}),
    }
  } catch {
    return undefined
  }
}

export function codeagentEnv(
  cfg: KernelConfig,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return {
    ...base,
    // 家目录类的变量指到 kits 的数据目录：内核的缓存、会话数据不落到用户家目录
    XDG_DATA_HOME: cfg.dataDir,
    XDG_CACHE_HOME: cfg.dataDir,
    XDG_CONFIG_HOME: cfg.dataDir,
    XDG_STATE_HOME: cfg.dataDir,
    // 和 OpenCode 一样：配置目录里有插件时不能等 npm 联网（见 opencode.ts 的 spawnEnv）
    npm_config_offline: 'true',
    npm_config_cache: path.join(cfg.dataDir, 'npm-cache'),
    ...cfg.env,
  }
}

export const API_PREFIX = '/api/v1'

// 就绪后核对配置有没有被读进去：默认模型对上就算读到了，否则 PATCH 一份（{env:…} 先换成值）
async function ensureConfig(
  baseUrl: string,
  headers: Record<string, string>,
  cfg: KernelConfig,
): Promise<void> {
  let wanted: Record<string, unknown>
  try {
    wanted = JSON.parse(await readFile(path.join(cfg.configDir, CODEAGENT_CONFIG_FILE), 'utf8'))
  } catch {
    return
  }
  const url = `${baseUrl}${API_PREFIX}/global/config`
  const current = (await fetch(url, { headers, signal: AbortSignal.timeout(5_000) })
    .then((r) => (r.ok ? r.json() : undefined))
    .catch(() => undefined)) as { model?: string } | undefined
  if (current?.model && current.model === wanted.model) return
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(resolveEnvRefs(wanted, cfg.env)),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`CodeAgent 配置写不进去：HTTP ${res.status} ${await res.text()}`)
}

export const codeagentDialect: KernelDialect = {
  id: 'codeagent',
  apiPrefix: API_PREFIX,
  permissionListPath: '/permission',

  async spawn(cfg: KernelConfig): Promise<SpawnedKernel> {
    const token = randomBytes(24).toString('base64url')
    const args = [
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--token',
      token,
      '--config-dir',
      cfg.configDir,
    ]
    // .cmd / .bat（Windows 上的启动脚本）要经 shell 才能起
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cfg.binary)
    const child = spawn(cfg.binary, args, {
      env: codeagentEnv(cfg),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...(viaShell ? { shell: true } : {}),
    })
    let output = ''
    const log = cfg.logFile ? openLog(cfg.logFile, 'codeagent serve') : undefined
    let ready: ((r: ReadyLine) => void) | undefined
    let pending = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-65_536)
      log?.write(chunk)
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const r = parseReadyLine(line)
        if (r) ready?.(r)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-65_536)
      log?.write(chunk)
    })

    let closing = false
    const exitListeners: ((exit: KernelExit) => void)[] = []
    child.once('close', () => log?.end())
    child.once('exit', (code, signal) => {
      if (closing) return
      const exit = { code, signal, tail: tail(output) }
      for (const l of exitListeners) l(exit)
    })
    const close = async (): Promise<void> => {
      closing = true
      await stopChild(child)
    }

    try {
      const info = await new Promise<ReadyLine>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(`codeagent 没有在 ${READY_TIMEOUT_MS / 1000} 秒内就绪\n${tail(output)}`),
            ),
          READY_TIMEOUT_MS,
        )
        ready = (r) => {
          clearTimeout(timer)
          resolve(r)
        }
        child.once('error', (e) => {
          clearTimeout(timer)
          reject(new Error(`codeagent 起不来：${e.message}`))
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`codeagent 启动时退出了（${code}）\n${tail(output)}`))
        })
      })
      // 就绪行里的 token 以它为准（文档说 --token 不传会自己生成）
      const headers = { Authorization: `Bearer ${info.token ?? token}` }
      await ensureConfig(info.baseUrl, headers, cfg)
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`codeagent 启动后马上退出了\n${tail(output)}`)
      }
      return {
        baseUrl: info.baseUrl,
        headers,
        close,
        onExit: (l) => void exitListeners.push(l),
      }
    } catch (e) {
      await close()
      throw e
    }
  },

  async writeConfig(dir: string, generated: GeneratedFiles): Promise<void> {
    await writeGeneratedFiles(dir, generated)
  },

  permissionReplyPath(requestId: string, _sessionId: string): string {
    return `/permission/${requestId}/reply`
  },
}
