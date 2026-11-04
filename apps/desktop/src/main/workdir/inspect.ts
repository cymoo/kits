import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkdirInspection } from '@kits/core/ipc'

// 首次引导：选了工作目录后看一眼 Git 分支和工作区。只读，不改任何文件。

const run = promisify(execFile)

async function git(dir: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd: dir, timeout: 5_000, windowsHide: true })
    return stdout.trim()
  } catch {
    return undefined
  }
}

export async function inspectWorkdir(dir: string): Promise<WorkdirInspection> {
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = branch === undefined ? undefined : await git(dir, ['status', '--porcelain'])
  return {
    path: dir,
    ...(branch !== undefined
      ? { git: { branch, changed: status ? status.split('\n').filter(Boolean).length : 0 } }
      : {}),
  }
}
