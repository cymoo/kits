#!/usr/bin/env node
// 把当前平台的 opencode 二进制拷到 vendor/opencode/<os>-<arch>/，供 electron-builder 的 extraResources 使用。
// 来源是 opencode-ai 装完后硬链接到自己 bin/ 下的二进制（所有平台都叫 opencode.exe）。
// CodeAgent 不在 npm 上，以后在这里加下载逻辑，放到 vendor/codeagent/<os>-<arch>/。
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.platform
const arch = process.arch

const require = createRequire(path.join(root, 'packages/kernel/package.json'))
let src
try {
  src = path.join(path.dirname(require.resolve('opencode-ai/package.json')), 'bin', 'opencode.exe')
} catch {
  console.error('opencode-ai is not installed; run pnpm install first')
  process.exit(1)
}

// electron-builder 的 ${os} 在 macOS 上是 mac、Windows 上是 win
const builderOs = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform] ?? platform
const file = platform === 'win32' ? 'opencode.exe' : 'opencode'
const dest = path.join(root, 'vendor/opencode', `${builderOs}-${arch}`, file)
mkdirSync(path.dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`)
