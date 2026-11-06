import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertKernel, assertRipgrep, kernelPath, ripgrepPath } from './check-kernel.mjs'

const X64 = 1
const ARM64 = 3

describe('kernelPath', () => {
  it('maps darwin arm64 to the mac-arm64 vendor directory', () => {
    expect(kernelPath('/repo', 'darwin', ARM64)).toBe(
      path.join('/repo', 'vendor/opencode/mac-arm64/opencode'),
    )
  })

  it('maps win32 x64 to opencode.exe in the win-x64 vendor directory', () => {
    expect(kernelPath('/repo', 'win32', X64)).toBe(
      path.join('/repo', 'vendor/opencode/win-x64/opencode.exe'),
    )
  })
})

describe('assertKernel', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'kits-kernel-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('throws and names the target when the binary is missing', () => {
    expect(() => assertKernel(base, 'win32', X64)).toThrow(/on a win x64 machine/)
  })

  it('passes when the binary is vendored', () => {
    const file = kernelPath(base, 'darwin', ARM64)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '')
    expect(() => assertKernel(base, 'darwin', ARM64)).not.toThrow()
  })
})

describe('ripgrepPath', () => {
  it('maps win32 x64 to rg.exe in the win-x64 vendor directory', () => {
    expect(ripgrepPath('/repo', 'win32', X64)).toBe(
      path.join('/repo', 'vendor/ripgrep/win-x64/rg.exe'),
    )
  })
})

describe('assertRipgrep', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'kits-ripgrep-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  const put = (file: string) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '')
  }

  it('throws on Windows when rg.exe is not vendored and says how to fix it', () => {
    expect(() => assertRipgrep(base, 'win32', X64)).toThrow(/pnpm vendor:kernel/)
  })

  it('throws on Windows when only the empty vendor directory is there', () => {
    mkdirSync(path.join(base, 'vendor/ripgrep/win-x64'), { recursive: true })
    expect(() => assertRipgrep(base, 'win32', X64)).toThrow(/third_party\/ripgrep\/win-x64/)
  })

  it('passes on Windows when rg.exe is vendored', () => {
    put(ripgrepPath(base, 'win32', X64))
    expect(() => assertRipgrep(base, 'win32', X64)).not.toThrow()
  })

  it('leaves a platform alone when kits does not bundle ripgrep for it', () => {
    expect(() => assertRipgrep(base, 'darwin', ARM64)).not.toThrow()
  })

  it('throws on any platform that has a bundled copy which was not vendored', () => {
    put(path.join(base, 'third_party/ripgrep/mac-arm64/rg'))
    expect(() => assertRipgrep(base, 'darwin', ARM64)).toThrow(/pnpm vendor:kernel/)
  })
})
