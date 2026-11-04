import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertKernel, kernelPath } from './check-kernel.mjs'

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
