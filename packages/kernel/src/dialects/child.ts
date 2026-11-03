import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'

// 两个方言共用的子进程小工具：日志文件、输出尾巴、结束进程树。

// 日志写不了（目录没权限、磁盘满）不能变成主进程的未捕获异常：出错后就不再写文件，输出照样留在内存里
export function openLog(file: string, title: string) {
  let stream: WriteStream | undefined
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    stream = createWriteStream(file, { flags: 'a' })
  } catch {
    return undefined
  }
  const log = {
    write(chunk: Buffer | string) {
      stream?.write(chunk)
    },
    end() {
      stream?.end()
    },
  }
  stream.on('error', () => {
    stream?.destroy()
    stream = undefined
  })
  log.write(`\n--- ${new Date().toISOString()} ${title} ---\n`)
  return log
}

export function tail(buf: string, lines = 20): string {
  return buf.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n')
}

// Windows：taskkill /T 结束进程树；taskkill 本身起不来时退回 child.kill
function killTree(pid: number, fallback: () => void): void {
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  killer.once('error', fallback)
}

// 结束内核进程：Windows 上整棵进程树一起结束（内核拉起的 stdio MCP 服务、命令会留下来）；
// 给 2 秒自己退，还不退就强杀
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    if (process.platform === 'win32' && child.pid !== undefined) {
      killTree(child.pid, () => {
        if (child.exitCode === null) child.kill()
      })
    } else {
      child.kill()
    }
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolve()
    }, 2_000).unref()
  })
}
