import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 先写临时文件再改名：写到一半崩了不会留下半个 JSON。
// mode 用在临时文件上（改名后保留），密钥表传 0o600，不依赖 umask 和父目录权限
export function writeFileAtomic(file: string, content: string, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, file)
}
