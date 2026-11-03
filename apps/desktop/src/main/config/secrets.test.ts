import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Encryptor, SecretStore } from './secrets'

// 假的加密：把字节反过来，够验证“存的不是明文、读回来是原文”
const fake = (available: boolean): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from(text, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
})

let file: string
beforeEach(() => {
  file = path.join(mkdtempSync(path.join(os.tmpdir(), 'kits-secrets-')), 'secrets.json')
})
afterEach(() => {
  rmSync(path.dirname(file), { recursive: true, force: true })
})

describe('SecretStore', () => {
  it('stores encrypted values and reads them back after a restart', () => {
    new SecretStore(file, fake(true)).set('gateway:corp', 'sk-123')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-123')
    const again = new SecretStore(file, fake(true))
    expect(again.has('gateway:corp')).toBe(true)
    expect(again.get('gateway:corp')).toBe('sk-123')
  })

  it('falls back to marked plain storage when encryption is unavailable', () => {
    const store = new SecretStore(file, fake(false))
    store.set('k', 'v')
    expect(store.encrypted).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).k.enc).toBe('plain')
    expect(store.get('k')).toBe('v')
  })

  it('removes a key', () => {
    const store = new SecretStore(file, fake(true))
    store.set('k', 'v')
    store.remove('k')
    expect(store.has('k')).toBe(false)
    expect(new SecretStore(file, fake(true)).get('k')).toBeUndefined()
  })
  it('starts empty and keeps a backup when the file is broken', () => {
    writeFileSync(file, '{ not json')
    const store = new SecretStore(file, fake(true))
    expect(store.loadError).toContain('secrets.json')
    expect(store.has('anything')).toBe(false)
    expect(readdirSync(path.dirname(file)).some((f) => f.startsWith('secrets.json.broken-'))).toBe(
      true,
    )
  })

  it('treats a value it cannot decrypt as missing', () => {
    new SecretStore(file, fake(true)).set('k', 'v')
    const broken: Encryptor = {
      ...fake(true),
      decrypt: () => {
        throw new Error('keychain changed')
      },
    }
    expect(new SecretStore(file, broken).get('k')).toBeUndefined()
    expect(new SecretStore(file, broken).has('k')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('writes the file readable by the owner only', () => {
    new SecretStore(file, fake(false)).set('k', 'v')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
