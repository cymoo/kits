import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AutoUpdaterLike,
  createUpdater,
  parseReleaseNotes,
  type ResolvedUrl,
  readBuiltinUrl,
  resolveUpdateUrl,
} from './updater'

// 真实的 autoUpdater 在版本号不是合法 semver 时构造就抛错，这里让“取它”这个动作直接失败
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      throw new Error('ERR_UPDATER_INVALID_VERSION')
    },
  },
}))

const URL_SET: ResolvedUrl = { url: 'http://ci/kits', source: 'builtin', off: false }

class FakeUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = true
  feeds: string[] = []
  // checkForUpdates 的返回值（带 downloadPromise、cancellationToken 时模拟后台下载）
  result: unknown = null
  installed: [boolean | undefined, boolean | undefined][] = []
  onCheck: () => void = () => {}
  setFeedURL(options: { url: string }) {
    this.feeds.push(options.url)
  }
  async checkForUpdates() {
    this.onCheck()
    return this.result
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installed.push([isSilent, isForceRunAfter])
  }
}

function packaged(fake: FakeUpdater, url: () => ResolvedUrl = () => URL_SET) {
  const changes: string[] = []
  const updater = createUpdater({
    isPackaged: true,
    version: '0.2.0',
    url,
    load: () => fake,
    now: () => 1000,
    onChange: (v) => changes.push(v.state.status),
  })
  return { updater, changes }
}

describe('resolveUpdateUrl', () => {
  it('prefers the environment variable over settings and the built-in address', () => {
    expect(resolveUpdateUrl('http://a', 'http://b', { KITS_UPDATE_URL: ' http://c ' })).toEqual({
      url: 'http://c',
      source: 'env',
      off: false,
    })
  })

  it('uses settings over the built-in address', () => {
    expect(resolveUpdateUrl('http://a', 'http://b', {})).toEqual({
      url: 'http://a',
      source: 'settings',
      off: false,
    })
  })

  it('falls back to the address that came with the installer', () => {
    expect(resolveUpdateUrl('  ', 'http://b', {})).toEqual({
      url: 'http://b',
      source: 'builtin',
      off: false,
    })
  })

  it('turns updates off when settings say off, even with a built-in address', () => {
    expect(resolveUpdateUrl('OFF', 'http://b', {})).toEqual({ url: '', source: null, off: true })
  })

  it('is empty when nothing is configured', () => {
    expect(resolveUpdateUrl('', '', { KITS_UPDATE_URL: '' })).toEqual({
      url: '',
      source: null,
      off: false,
    })
  })
})

describe('readBuiltinUrl', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kits-update-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const write = (text: string) => {
    const file = path.join(dir, 'app-update.yml')
    writeFileSync(file, text)
    return file
  }

  it('reads the url electron-builder wrote into app-update.yml', () => {
    const file = write('provider: generic\nurl: http://ci.corp:8080/userContent/kits\n')
    expect(readBuiltinUrl(file)).toBe('http://ci.corp:8080/userContent/kits')
  })

  it('ignores the placeholder address of the repository config', () => {
    expect(readBuiltinUrl(write('provider: generic\nurl: https://updates.invalid/kits\n'))).toBe('')
  })

  it('is empty when the file is missing', () => {
    expect(readBuiltinUrl(path.join(dir, 'missing.yml'))).toBe('')
  })
})

describe('parseReleaseNotes', () => {
  it('turns the CHANGELOG section into items with their kind', () => {
    const md =
      '### 新增\n- 侧栏提示新版本\n\n### 修复\n- 修好 `rg` 找不到的问题\n- 改了 [文档](http://x)'
    expect(parseReleaseNotes(md)).toEqual([
      { kind: '新增', text: '侧栏提示新版本' },
      { kind: '修复', text: '修好 rg 找不到的问题' },
      { kind: '修复', text: '改了 文档' },
    ])
  })

  it('joins an indented continuation line to its item', () => {
    expect(parseReleaseNotes('- 第一行\n  第二行')).toEqual([{ kind: '', text: '第一行 第二行' }])
  })

  it('reads the array form electron-updater gives with fullChangelog', () => {
    expect(parseReleaseNotes([{ version: '0.2.1', note: '### 修复\n- a' }])).toEqual([
      { kind: '修复', text: 'a' },
    ])
  })

  it('is empty when there are no notes', () => {
    expect(parseReleaseNotes(null)).toEqual([])
  })
})

describe('createUpdater', () => {
  it('leaves electron-updater alone when the app is not packaged', async () => {
    const updater = createUpdater({ isPackaged: false, url: () => URL_SET, version: '0.0' })
    expect((await updater.check()).state).toEqual({ status: 'disabled', reason: 'dev' })
  })

  it('reports off and does not check when updates are turned off', async () => {
    const fake = new FakeUpdater()
    const { updater } = packaged(fake, () => ({ url: '', source: null, off: true }))
    expect((await updater.check()).state).toEqual({ status: 'disabled', reason: 'off' })
    expect(fake.feeds).toEqual([])
  })

  it('reports latest when no newer version is available', async () => {
    const fake = new FakeUpdater()
    fake.onCheck = () => fake.emit('update-not-available', { version: '0.2.0' })
    const { updater, changes } = packaged(fake)
    expect((await updater.check()).state).toEqual({ status: 'latest', checkedAt: 1000 })
    expect(changes).toEqual(['checking', 'latest'])
    expect(fake.feeds).toEqual(['http://ci/kits'])
    expect(fake.autoDownload).toBe(true)
  })

  it('goes from downloading to ready with the parsed notes', async () => {
    const fake = new FakeUpdater()
    fake.onCheck = () => {
      fake.emit('update-available', { version: '0.2.1' })
      fake.emit('download-progress', { percent: 41.7 })
      fake.emit('update-downloaded', {
        version: '0.2.1',
        releaseDate: '2026-11-07',
        releaseNotes: '### 修复\n- a',
      })
    }
    const { updater, changes } = packaged(fake)
    expect((await updater.check()).state).toEqual({
      status: 'ready',
      version: '0.2.1',
      releaseDate: '2026-11-07',
      notes: [{ kind: '修复', text: 'a' }],
    })
    expect(changes).toEqual(['checking', 'downloading', 'downloading', 'ready'])
  })

  it('keeps a downloaded update when a later check fails', async () => {
    const fake = new FakeUpdater()
    fake.onCheck = () => fake.emit('update-downloaded', { version: '0.2.1' })
    const { updater } = packaged(fake)
    await updater.check()
    fake.emit('error', new Error('net::ERR_CONNECTION_REFUSED'))
    expect(updater.view().state.status).toBe('ready')
  })

  it('shows only the first line of an error', async () => {
    const fake = new FakeUpdater()
    fake.checkForUpdates = async () => {
      throw new Error('HttpError: 404\nheaders: {...}')
    }
    const { updater } = packaged(fake)
    expect((await updater.check()).state).toEqual({
      status: 'error',
      message: 'HttpError: 404',
      checkedAt: 1000,
    })
  })

  it('turns off installing on quit until an update is downloaded', async () => {
    const fake = new FakeUpdater()
    fake.onCheck = () => fake.emit('update-not-available', {})
    const { updater } = packaged(fake)
    await updater.check()
    expect(fake.autoInstallOnAppQuit).toBe(false)
    fake.emit('update-downloaded', { version: '0.2.1' })
    expect(fake.autoInstallOnAppQuit).toBe(true)
  })

  it('stops installing on quit when updates are turned off after a download', async () => {
    let url = URL_SET
    const fake = new FakeUpdater()
    fake.onCheck = () => fake.emit('update-downloaded', { version: '0.2.1' })
    const { updater } = packaged(fake, () => url)
    await updater.check()
    url = { url: '', source: null, off: true }
    await updater.notify()
    expect(fake.autoInstallOnAppQuit).toBe(false)
    expect(updater.view().state).toEqual({ status: 'disabled', reason: 'off' })
    updater.install()
    expect(fake.installed).toEqual([])
  })

  it('forgets the update from the old address and checks the new one', async () => {
    let url = URL_SET
    const fake = new FakeUpdater()
    fake.onCheck = () => fake.emit('update-downloaded', { version: '0.2.1' })
    const { updater } = packaged(fake, () => url)
    await updater.check()
    url = { url: 'http://other/kits', source: 'settings', off: false }
    fake.onCheck = () => fake.emit('update-not-available', {})
    await updater.notify()
    expect(fake.feeds).toEqual(['http://ci/kits', 'http://other/kits'])
    expect(updater.view().state).toEqual({ status: 'latest', checkedAt: 1000 })
    expect(fake.autoInstallOnAppQuit).toBe(false)
  })

  it('cancels a download from an address that was turned off and ignores what it reports later', async () => {
    let url = URL_SET
    const fake = new FakeUpdater()
    const cancel = vi.fn()
    let finish = () => {}
    fake.result = {
      downloadPromise: new Promise((resolve) => {
        finish = () => resolve([])
      }),
      cancellationToken: {
        cancel: () => {
          cancel()
          finish()
        },
      },
    }
    fake.onCheck = () => fake.emit('update-available', { version: '0.2.1' })
    const { updater } = packaged(fake, () => url)
    expect((await updater.check()).state.status).toBe('downloading')

    url = { url: '', source: null, off: true }
    await updater.notify()
    expect(cancel).toHaveBeenCalledOnce()
    fake.emit('update-downloaded', { version: '0.2.1' })
    expect(fake.autoInstallOnAppQuit).toBe(false)

    // 再打开：旧下载结束后重新查
    url = URL_SET
    fake.result = null
    fake.onCheck = () => fake.emit('update-not-available', {})
    await updater.notify()
    expect(updater.view().state).toEqual({ status: 'latest', checkedAt: 1000 })
  })

  it('installs silently and reopens kits only after the update is downloaded', async () => {
    const fake = new FakeUpdater()
    const { updater } = packaged(fake)
    updater.install()
    expect(fake.installed).toEqual([])
    fake.onCheck = () => fake.emit('update-downloaded', { version: '0.2.1' })
    await updater.check()
    updater.install()
    expect(fake.installed).toEqual([[true, true]])
  })
})
