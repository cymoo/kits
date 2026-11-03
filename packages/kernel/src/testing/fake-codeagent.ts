import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 假 CodeAgent 服务的启动脚本：方言按“二进制”去起它，所以写一个可执行的包装（Windows 是 .cmd）。
// 服务本身在旁边的 fake-codeagent-server.mjs，用当前的 node 跑。

export const FAKE_CODEAGENT_SCRIPT = path.join(import.meta.dirname, 'fake-codeagent-server.mjs')

export function fakeCodeagentBinary(dir: string): string {
  if (process.platform === 'win32') {
    const file = path.join(dir, 'codeagent.cmd')
    writeFileSync(file, `@"${process.execPath}" "${FAKE_CODEAGENT_SCRIPT}" %*\r\n`)
    return file
  }
  const file = path.join(dir, 'codeagent')
  writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CODEAGENT_SCRIPT}" "$@"\n`)
  chmodSync(file, 0o755)
  return file
}
