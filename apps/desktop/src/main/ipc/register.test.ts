import { describe, expect, it } from 'vitest'
import { trustedUrl } from './register'

describe('trustedUrl', () => {
  it('accepts only the packaged index.html on file urls', () => {
    const ok = trustedUrl(
      'file:///Applications/kits.app/Contents/Resources/app.asar/out/renderer/index.html',
    )
    expect(
      ok(
        'file:///Applications/kits.app/Contents/Resources/app.asar/out/renderer/index.html#/settings',
      ),
    ).toBe(true)
    expect(ok('file:///Users/me/Downloads/evil.html')).toBe(false)
    expect(ok('https://example.com/')).toBe(false)
  })

  it('accepts the dev server origin only', () => {
    const ok = trustedUrl('http://localhost:5173/')
    expect(ok('http://localhost:5173/#/s/1')).toBe(true)
    expect(ok('http://localhost:5174/')).toBe(false)
    expect(ok('not a url')).toBe(false)
  })
})
