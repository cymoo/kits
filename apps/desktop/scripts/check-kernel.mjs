// electron-builder 的 beforePack 钩子：vendor/ 里没有目标平台的 OpenCode 就让打包失败。
// extraResources 的来源不存在时 electron-builder 只打警告，会打出一个没有内核、装上也用不了的包。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// electron-builder 的 Arch 枚举值
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']
const OS_NAMES = { darwin: 'mac', win32: 'win', linux: 'linux' }

export function kernelPath(base, platform, arch) {
  const file = platform === 'win32' ? 'opencode.exe' : 'opencode'
  const target = `${OS_NAMES[platform]}-${ARCH_NAMES[arch]}`
  return path.join(base, 'vendor/opencode', target, file)
}

export function assertKernel(base, platform, arch) {
  const file = kernelPath(base, platform, arch)
  if (!existsSync(file)) {
    throw new Error(
      `OpenCode binary not found at ${file}; run pnpm vendor:kernel on a ${OS_NAMES[platform]} ${ARCH_NAMES[arch]} machine first`,
    )
  }
}

export default function beforePack(context) {
  assertKernel(root, context.electronPlatformName, context.arch)
}
