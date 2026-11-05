import { describe, expect, it, vi } from 'vitest'
import { createUpdater, updateUrl } from './updater'

// 真实的 autoUpdater 在版本号不是合法 semver 时构造就抛错，这里让“取它”这个动作直接失败
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      throw new Error('ERR_UPDATER_INVALID_VERSION')
    },
  },
}))

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

describe('createUpdater', () => {
  it('leaves electron-updater alone when the app is not packaged', async () => {
    const updater = createUpdater({ isPackaged: false, url: () => '', version: '0.0' })
    expect(await updater.check()).toEqual({ status: 'disabled', reason: 'dev' })
  })
})
