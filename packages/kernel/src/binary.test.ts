import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  binaryFileName,
  kernelBinaryCandidates,
  opencodePackageName,
  resolveKernelBinary,
} from './binary'

const here = { platform: process.platform, arch: process.arch, env: {} }

describe('kernelBinaryCandidates', () => {
  it('puts the env override first', () => {
    const c = kernelBinaryCandidates('opencode', {
      ...here,
      env: { KITS_OPENCODE_BIN: '/x/opencode' },
    })
    expect(c[0]).toBe('/x/opencode')
  })

  it('looks in the packaged resources dir before the npm package', () => {
    const c = kernelBinaryCandidates('opencode', { ...here, resourcesPath: '/app/Resources' })
    expect(c[0]).toBe(
      path.join('/app/Resources', 'bin', 'opencode', binaryFileName('opencode', process.platform)),
    )
    expect(c.some((p) => p.includes('opencode-ai'))).toBe(true)
  })

  it('finds the opencode binary installed by the opencode-ai dev dependency', () => {
    const bin = resolveKernelBinary('opencode', here)
    expect(bin).toBeDefined()
    expect(existsSync(bin ?? '')).toBe(true)
  })

  it('uses an .exe file name on windows', () => {
    expect(binaryFileName('codeagent', 'win32')).toBe('codeagent.exe')
    expect(binaryFileName('codeagent', 'linux')).toBe('codeagent')
  })

  it('maps win32 to the windows npm package', () => {
    expect(opencodePackageName('win32', 'x64')).toBe('opencode-windows-x64')
    expect(opencodePackageName('darwin', 'arm64')).toBe('opencode-darwin-arm64')
  })
})
