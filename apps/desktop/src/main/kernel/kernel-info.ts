import { execFile } from 'node:child_process'
import path from 'node:path'
import type { KernelInfo, KernelName } from '@kits/core/ipc'
import { resolveKernelBinary } from '@kits/kernel'

// 设置页“Agent 内核”卡片用：哪个内核装了、版本、日志目录。进程管理在 KernelManager（PR6）。

export const KERNELS: KernelName[] = ['opencode', 'codeagent']

export function kernelLogsDir(userDataDir: string, id: KernelName): string {
  return path.join(userDataDir, 'kernel', id, 'logs')
}

function version(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: 5_000, windowsHide: true }, (err, stdout) => {
      const line = String(stdout).trim().split(/\r?\n/)[0]
      resolve(err || !line ? null : line)
    })
  })
}

export async function kernelInfo(options: {
  userDataDir: string
  resourcesPath: string | undefined
}): Promise<KernelInfo[]> {
  return Promise.all(
    KERNELS.map(async (id) => {
      const binary =
        resolveKernelBinary(id, {
          platform: process.platform,
          arch: process.arch,
          env: process.env,
          ...(options.resourcesPath ? { resourcesPath: options.resourcesPath } : {}),
        }) ?? null
      return {
        id,
        installed: binary !== null,
        version: binary ? await version(binary) : null,
        binary,
        logsDir: kernelLogsDir(options.userDataDir, id),
      }
    }),
  )
}
