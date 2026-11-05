import { describe, expect, it } from 'vitest'
import { workdirKey } from './workdir'

describe('workdirKey', () => {
  it('ignores a trailing separator', () => {
    expect(workdirKey('/repo/kits/')).toBe(workdirKey('/repo/kits'))
  })

  it('keeps the root directory', () => {
    expect(workdirKey('/')).toBe('/')
  })

  it('treats Windows paths as case insensitive', () => {
    expect(workdirKey('C:/Repo/Kits')).toBe(workdirKey('c:\\repo\\kits\\'))
  })

  it('keeps the case of other paths', () => {
    expect(workdirKey('/Repo')).not.toBe(workdirKey('/repo'))
  })
})
