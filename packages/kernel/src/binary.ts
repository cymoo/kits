import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { KernelId } from './kernel'

// 内核二进制的查找顺序：环境变量 → 打包后的 resources 目录 → npm 包（开发时）→ 不找 PATH，找不到就报错。
// CodeAgent 不在 npm 上，以后由下载脚本放进 vendor/，走 resources 这一条。

export interface BinaryLookup {
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
  // Electron 打包后的 process.resourcesPath；开发时不传
  resourcesPath?: string
}

const ENV_OVERRIDE: Record<KernelId, string> = {
  opencode: 'KITS_OPENCODE_BIN',
  codeagent: 'KITS_CODEAGENT_BIN',
}

export function binaryFileName(kernel: KernelId, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${kernel}.exe` : kernel
}

// opencode-ai 的平台包名：opencode-darwin-arm64、opencode-windows-x64 …
export function opencodePackageName(platform: NodeJS.Platform, arch: string): string {
  const os = platform === 'win32' ? 'windows' : platform
  return `opencode-${os}-${arch}`
}

// opencode-ai 装完会把当前平台的二进制硬链接到自己的 bin/opencode.exe（所有平台都叫这个名字）；
// 平台包是它的依赖，要从它的目录往下找。
export function opencodeNpmCandidates(platform: NodeJS.Platform, arch: string): string[] {
  const require = createRequire(import.meta.url)
  let wrapperDir: string
  try {
    wrapperDir = path.dirname(require.resolve('opencode-ai/package.json'))
  } catch {
    return []
  }
  const candidates = [path.join(wrapperDir, 'bin', 'opencode.exe')]
  try {
    const fromWrapper = createRequire(path.join(wrapperDir, 'package.json'))
    const pkgJson = fromWrapper.resolve(`${opencodePackageName(platform, arch)}/package.json`)
    candidates.push(path.join(path.dirname(pkgJson), 'bin', binaryFileName('opencode', platform)))
  } catch {
    // 平台包没装（跨平台时正常）
  }
  return candidates
}

export function kernelBinaryCandidates(kernel: KernelId, lookup: BinaryLookup): string[] {
  const file = binaryFileName(kernel, lookup.platform)
  const candidates: string[] = []
  const override = lookup.env[ENV_OVERRIDE[kernel]]
  if (override) candidates.push(override)
  if (lookup.resourcesPath) {
    candidates.push(path.join(lookup.resourcesPath, 'bin', kernel, file))
  }
  if (kernel === 'opencode') {
    candidates.push(...opencodeNpmCandidates(lookup.platform, lookup.arch))
  }
  return candidates
}

export function resolveKernelBinary(kernel: KernelId, lookup: BinaryLookup): string | undefined {
  return kernelBinaryCandidates(kernel, lookup).find((p) => existsSync(p))
}
