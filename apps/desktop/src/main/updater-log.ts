import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import type { UpdateLogLevel } from './updater'

// 自动更新的日志：每次检查、下载、出错、安装各一行，写在 {userData}/logs/updater.log。
// 超过 1 MB 时把旧的改名成 updater.log.old 再从头写；写不了（目录没权限、磁盘满）就不再写，不影响更新本身。

const MAX_BYTES = 1024 * 1024

export function createUpdateLog(file: string, now: () => Date = () => new Date()) {
  let broken = false
  return (level: UpdateLogLevel, message: string) => {
    if (broken) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      try {
        if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`)
      } catch {
        // 还没有日志文件
      }
      appendFileSync(file, `${now().toISOString()} ${level} ${message}\n`)
    } catch {
      broken = true
    }
  }
}
