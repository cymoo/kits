// electron-builder 的 beforePack 钩子：vendor/ 里没有目标平台的 OpenCode 或 ripgrep 就让打包失败。
// extraResources 的来源不存在时 electron-builder 只打警告，会打出一个没有内核、装上也用不了的包，
// 少了 ripgrep 时内网的 grep、glob 全部报 `ripgrep execution failed`。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// electron-builder 的 Arch 枚举值
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']
const OS_NAMES = { darwin: 'mac', win32: 'win', linux: 'linux' }

function targetOf(platform, arch) {
  return `${OS_NAMES[platform]}-${ARCH_NAMES[arch]}`
}

export function kernelPath(base, platform, arch) {
  const file = platform === 'win32' ? 'opencode.exe' : 'opencode'
  return path.join(base, 'vendor/opencode', targetOf(platform, arch), file)
}

export function assertKernel(base, platform, arch) {
  const file = kernelPath(base, platform, arch)
  if (!existsSync(file)) {
    throw new Error(
      `OpenCode binary not found at ${file}; run pnpm vendor:kernel on a ${OS_NAMES[platform]} ${ARCH_NAMES[arch]} machine first`,
    )
  }
}

export function ripgrepPath(base, platform, arch) {
  const file = platform === 'win32' ? 'rg.exe' : 'rg'
  return path.join(base, 'vendor/ripgrep', targetOf(platform, arch), file)
}

// Windows 一定要带：third_party 没同步过来也算缺。其他平台有 third_party 目录才算随包带的
export function assertRipgrep(base, platform, arch) {
  const target = targetOf(platform, arch)
  const bundled = platform === 'win32' || existsSync(path.join(base, 'third_party/ripgrep', target))
  const file = ripgrepPath(base, platform, arch)
  if (bundled && !existsSync(file)) {
    throw new Error(
      `ripgrep not found at ${file}; check third_party/ripgrep/${target} and run pnpm vendor:kernel`,
    )
  }
}

export default function beforePack(context) {
  assertKernel(root, context.electronPlatformName, context.arch)
  assertRipgrep(root, context.electronPlatformName, context.arch)
}
