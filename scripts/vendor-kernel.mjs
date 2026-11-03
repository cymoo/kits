#!/usr/bin/env node
// 把当前平台的内核二进制拷到 vendor/<内核>/<os>-<arch>/，供 electron-builder 的 extraResources 使用。
// OpenCode 来自 opencode-ai 装完后硬链接到自己 bin/ 下的二进制（所有平台都叫 opencode.exe）；
// CodeAgent 不在 npm 上：设了 KITS_CODEAGENT_BIN 就把它拷过去，没设就跳过（安装包里不带 CodeAgent）。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
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

const codeagent = process.env.KITS_CODEAGENT_BIN
if (codeagent && existsSync(codeagent)) {
  const name = platform === 'win32' ? 'codeagent.exe' : 'codeagent'
  const to = path.join(root, 'vendor/codeagent', `${builderOs}-${arch}`, name)
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(codeagent, to)
  console.log(`copied ${codeagent} -> ${path.relative(root, to)}`)
} else {
  // 目录要在，electron-builder 的 extraResources 才不报错；空目录装进去就是“未安装”
  mkdirSync(path.join(root, 'vendor/codeagent', `${builderOs}-${arch}`), { recursive: true })
  console.log('KITS_CODEAGENT_BIN not set; packaging without CodeAgent')
}
