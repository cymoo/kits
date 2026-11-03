import { describe, expect, it } from 'vitest'
import { updateUrl } from './updater'

describe('updateUrl', () => {
  it('prefers the environment variable over settings', () => {
    expect(updateUrl('https://a/kits', { KITS_UPDATE_URL: 'https://b/kits' })).toBe(
      'https://b/kits',
    )
  })

  it('falls back to settings and is empty when nothing is set', () => {
    expect(updateUrl(' https://a/kits ', {})).toBe('https://a/kits')
    expect(updateUrl('', { KITS_UPDATE_URL: '  ' })).toBe('')
  })
})
