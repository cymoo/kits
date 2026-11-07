import { EventEmitter } from 'node:events'
import type { AutoUpdaterLike } from './updater'

// E2E 和界面开发用的假更新（KITS_UPDATE_MOCK，和 KITS_KERNEL=mock 一样只在测试里设）：不连网，
// 查一次就按模式给结果。ready 下载好了下一个修订版；downloading 停在 42%；latest 已是最新；error 连不上。
// “重启并更新”在这里什么都不做。

export const MOCK_UPDATE_URL = 'http://updates.mock/kits'

const NOTES = [
  '### 新增',
  '- 有新版本时侧栏底部提示，点开能看更新内容',
  '',
  '### 修复',
  '- Windows 上 grep、glob 报找不到 ripgrep',
  '- 删掉会话时，内核里的会话也一起删掉',
].join('\n')

export function nextPatch(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('-')[0]?.split('.') ?? []
  return `${major}.${minor}.${Number(patch) + 1}`
}

export function mockUpdater(mode: string, current: string): AutoUpdaterLike {
  const version = nextPatch(current)
  const emitter = new EventEmitter()
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    setFeedURL() {},
    async checkForUpdates() {
      if (mode === 'error') throw new Error('net::ERR_CONNECTION_REFUSED (mock)')
      if (mode === 'latest') {
        emitter.emit('update-not-available', { version: current })
        return null
      }
      emitter.emit('update-available', { version })
      emitter.emit('download-progress', { percent: 42 })
      if (mode === 'downloading') return null
      emitter.emit('update-downloaded', {
        version,
        releaseDate: '2026-11-07T04:00:00.000Z',
        releaseNotes: NOTES,
      })
      return null
    },
    quitAndInstall() {},
    on(event, listener) {
      emitter.on(event, listener)
      return emitter
    },
  }
}
