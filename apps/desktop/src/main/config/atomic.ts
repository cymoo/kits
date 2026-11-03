import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 先写临时文件再改名：写到一半崩了不会留下半个 JSON
export function writeFileAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}
