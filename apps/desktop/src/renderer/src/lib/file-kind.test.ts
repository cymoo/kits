import { describe, expect, it } from 'vitest'
import { fileKind } from './file-kind'

describe('fileKind', () => {
  it('goes by the extension whatever its case', () => {
    expect(fileKind('README.MD')).toBe('doc')
    expect(fileKind('a.py')).toBe('code')
    expect(fileKind('orders.csv')).toBe('sheet')
  })

  it('reads a dotfile name as its extension', () => {
    expect(fileKind('.env')).toBe('data')
  })

  it('has no kind for a name without a known extension', () => {
    expect(fileKind('LICENSE')).toBe('other')
    expect(fileKind('.python-version')).toBe('other')
  })
})
