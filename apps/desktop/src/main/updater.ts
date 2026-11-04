import electronUpdater from 'electron-updater'

// 自动更新（phase1-implementation PR20）：electron-updater 的 generic provider，内网放一个静态目录就行。
// 地址先看环境变量 KITS_UPDATE_URL，再看 settings.json 的 updateUrl；都没配、或者没打包（开发时）就不检查。
// 下载完由 electron-updater 发系统通知，退出时装上。

export type UpdateCheck =
  | { status: 'disabled'; reason: 'dev' | 'no-url' }
  | { status: 'latest'; version: string }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string }

const SIX_HOURS = 6 * 60 * 60 * 1000

export function updateUrl(settingsUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env.KITS_UPDATE_URL ?? '').trim() || settingsUrl.trim()
}

export function createUpdater(deps: { isPackaged: boolean; url(): string; version: string }) {
  const { autoUpdater } = electronUpdater
  let feed = ''
  const check = async (): Promise<UpdateCheck> => {
    if (!deps.isPackaged) return { status: 'disabled', reason: 'dev' }
    const url = deps.url()
    if (!url) return { status: 'disabled', reason: 'no-url' }
    if (url !== feed) {
      autoUpdater.setFeedURL({ provider: 'generic', url })
      feed = url
    }
    try {
      const result = await autoUpdater.checkForUpdatesAndNotify()
      const version = result?.updateInfo.version
      return version && version !== deps.version
        ? { status: 'available', version }
        : { status: 'latest', version: deps.version }
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }
  return {
    check,
    // 启动后过一会儿查一次，之后每 6 小时查一次；查不到（内网没开、地址错）不打扰人
    start() {
      setTimeout(() => void check(), 30_000).unref()
      setInterval(() => void check(), SIX_HOURS).unref()
    },
  }
}
