import { readFileSync } from 'node:fs'
import type { UpdateNote, UpdateSource, UpdateState, UpdateView } from '@kits/core/ipc'
import electronUpdater from 'electron-updater'

// 自动更新：electron-updater 的 generic provider，内网放一个静态目录就行（Jenkins 的 userContent 也可以）。
// 地址按 KITS_UPDATE_URL → settings.json 的 updateUrl → 安装包自带（打包时 -c.publish.url 写进 app-update.yml）的顺序取，
// 任一处写 "off" 就关掉。没打包（开发、E2E）不检查。
// 新版本在后台下载，下载好了只在侧栏底部出一个标签，不发系统通知、不自动重启；不点的话退出 kits 时自动装上。

const SIX_HOURS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 30_000

// 仓库里 electron-builder.yml 的 publish.url 是占位地址（updates.invalid），GitHub 上打的包当作没自带地址
export function readBuiltinUrl(file: string): string {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const m = text.match(/^url:\s*(.+?)\s*$/m)
  if (!m?.[1]) return ''
  const url = m[1].replace(/^(['"])(.*)\1$/, '$2').trim()
  try {
    return new URL(url).hostname.endsWith('.invalid') ? '' : url
  } catch {
    return ''
  }
}

export interface ResolvedUrl {
  url: string
  source: UpdateSource | null
  off: boolean
}

export function resolveUpdateUrl(
  settingsUrl: string,
  builtin: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedUrl {
  const candidates: [UpdateSource, string][] = [
    ['env', env.KITS_UPDATE_URL ?? ''],
    ['settings', settingsUrl],
    ['builtin', builtin],
  ]
  for (const [source, raw] of candidates) {
    const value = raw.trim()
    if (!value) continue
    if (value.toLowerCase() === 'off') return { url: '', source: null, off: true }
    return { url: value, source, off: false }
  }
  return { url: '', source: null, off: false }
}

// latest.yml 的 releaseNotes 是打包时从 CHANGELOG 取出的这个版本那一节（scripts/release-notes.mjs）：
// “### 分类”下面一条条列表项。electron-updater 的 fullChangelog 打开时给的是 { version, note } 数组
const plain = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim()

export function parseReleaseNotes(raw: unknown): UpdateNote[] {
  const text = Array.isArray(raw)
    ? raw
        .map((r) => (r && typeof r === 'object' && 'note' in r ? String(r.note ?? '') : ''))
        .join('\n')
    : typeof raw === 'string'
      ? raw
      : ''
  const notes: UpdateNote[] = []
  let kind = ''
  let last: UpdateNote | undefined
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/)
    if (heading?.[1]) {
      kind = plain(heading[1])
      last = undefined
      continue
    }
    const item = line.match(/^\s{0,1}[-*]\s+(.+?)\s*$/)
    if (item?.[1]) {
      last = { kind, text: plain(item[1]) }
      notes.push(last)
      continue
    }
    // 一条写成了好几行：缩进的续行接到上一条后面
    if (last && /^\s{2,}\S/.test(line)) last.text = `${last.text} ${plain(line)}`
    else if (!line.trim()) last = undefined
  }
  return notes
}

// electron-updater 的错误信息里常带整段响应头，界面只放第一行
function shortMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  const first = text.split('\n')[0] ?? text
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

// electron-updater 里用到的部分，测试里换成假的
export interface AutoUpdaterLike {
  autoDownload: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (arg: unknown) => void): unknown
}

interface UpdateInfoLike {
  version: string
  releaseDate?: string
  releaseNotes?: unknown
}

export function createUpdater(deps: {
  isPackaged: boolean
  version: string
  url(): ResolvedUrl
  onChange?(view: UpdateView): void
  // 取 autoUpdater 会构造 electron-updater 的实例，它在构造时校验 app.getVersion() 是不是合法 semver。
  // 未打包启动（开发、E2E）时这个值可能是 "0.0"，构造会直接抛 ERR_UPDATER_INVALID_VERSION；
  // 而 createUpdater 是在主进程启动链上同步调用的，一抛后面的窗口就建不起来。所以推迟到真要检查更新时再取。
  load?(): AutoUpdaterLike
  now?(): number
  // 启动后多久查第一次（E2E 用假更新时不等 30 秒）
  firstCheckMs?: number
}) {
  const load = deps.load ?? (() => electronUpdater.autoUpdater as unknown as AutoUpdaterLike)
  const now = deps.now ?? Date.now
  let state: UpdateState = { status: 'idle' }
  let updater: AutoUpdaterLike | undefined
  let feed = ''

  const view = (): UpdateView => {
    const u = deps.url()
    const current = deps.version
    if (!deps.isPackaged)
      return { current, url: u.url, source: u.source, state: { status: 'disabled', reason: 'dev' } }
    if (u.off)
      return { current, url: '', source: null, state: { status: 'disabled', reason: 'off' } }
    if (!u.url)
      return { current, url: '', source: null, state: { status: 'disabled', reason: 'no-url' } }
    return { current, url: u.url, source: u.source, state }
  }
  const set = (next: UpdateState) => {
    state = next
    deps.onChange?.(view())
  }
  // 事件回调和 await 之后都要读最新的状态（set 会换掉它），不能用前面判断时收窄的类型
  const status = (): UpdateState['status'] => state.status
  // 下载好了就不再变：之后的检查、出错都不把“可以装了”盖掉
  const settled = () => status() === 'ready'

  const ensure = (): AutoUpdaterLike => {
    if (updater) return updater
    const u = load()
    u.autoDownload = true
    u.on('update-available', (arg) => {
      const info = arg as UpdateInfoLike
      if (!settled()) set({ status: 'downloading', version: info.version, percent: 0 })
    })
    u.on('download-progress', (arg) => {
      if (state.status !== 'downloading') return
      const percent = Math.floor((arg as { percent: number }).percent)
      if (percent !== state.percent) set({ ...state, percent })
    })
    u.on('update-not-available', () => {
      if (!settled()) set({ status: 'latest', checkedAt: now() })
    })
    u.on('update-downloaded', (arg) => {
      const info = arg as UpdateInfoLike
      set({
        status: 'ready',
        version: info.version,
        releaseDate: info.releaseDate ?? null,
        notes: parseReleaseNotes(info.releaseNotes),
      })
    })
    u.on('error', (e) => {
      if (!settled()) set({ status: 'error', message: shortMessage(e), checkedAt: now() })
    })
    updater = u
    return u
  }

  const check = async (): Promise<UpdateView> => {
    const u = deps.url()
    if (!deps.isPackaged || !u.url) return view()
    // 正在查、正在下、已经下好：不重复查
    if (status() === 'checking' || status() === 'downloading' || settled()) return view()
    let up: AutoUpdaterLike
    try {
      up = ensure()
    } catch (e) {
      set({ status: 'error', message: shortMessage(e), checkedAt: now() })
      return view()
    }
    if (u.url !== feed) {
      up.setFeedURL({ provider: 'generic', url: u.url })
      feed = u.url
    }
    set({ status: 'checking' })
    try {
      await up.checkForUpdates()
    } catch (e) {
      if (!settled()) set({ status: 'error', message: shortMessage(e), checkedAt: now() })
    }
    // 没有任何事件回来（electron-updater 判断不需要检查）时也别停在“正在检查”
    if (status() === 'checking') set({ status: 'latest', checkedAt: now() })
    return view()
  }

  return {
    view,
    check,
    // 静默安装并重新打开 kits。界面在有会话运行时不让点；退出流程照常走 will-quit 的清理
    install() {
      if (!settled() || !updater) return
      updater.quitAndInstall(true, true)
    },
    // 设置改了（updateUrl）：地址和“没配 / 关掉”的状态跟着变
    notify() {
      deps.onChange?.(view())
    },
    // 启动后过一会儿查一次，之后每 6 小时查一次；查不到（内网没开、地址错）不打扰人
    start() {
      setTimeout(() => void check(), deps.firstCheckMs ?? FIRST_CHECK_MS).unref()
      setInterval(() => void check(), SIX_HOURS).unref()
    },
  }
}
