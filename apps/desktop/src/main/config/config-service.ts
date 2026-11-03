import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { parseSettings, type Settings } from '@kits/core'
import { applySettingsPatch, type SettingsPatch } from '@kits/core/ipc'
import { writeFileAtomic } from './atomic'
import { type ConfigPaths, configPaths } from './paths'

// ~/.kits 的读写。设置文件人也会手改：
// - 文件不存在用默认值，第一次保存时才创建；
// - 文件坏了（不是 JSON、字段不合法）不覆盖：先用默认值跑，loadError 交给界面提示，
//   用户在界面里保存时先把坏文件备份成 settings.json.broken-<时间>，再写新的。

export interface ConfigServiceOptions {
  dir: string
  onSettingsChanged?: (settings: Settings) => void
  now?: () => number
}

export class ConfigService {
  readonly paths: ConfigPaths
  private settings: Settings
  private broken = false
  // 上次读到的文件修改时间；人在编辑器里改了之后，下次读写前重新加载
  private mtime = 0
  loadError: string | undefined

  constructor(private readonly options: ConfigServiceOptions) {
    this.paths = configPaths(options.dir)
    this.settings = this.readSettings()
  }

  private fileMtime(): number {
    try {
      return statSync(this.paths.settings).mtimeMs
    } catch {
      return 0
    }
  }

  private readSettings(): Settings {
    this.mtime = this.fileMtime()
    if (!existsSync(this.paths.settings)) return parseSettings({})
    try {
      const settings = parseSettings(JSON.parse(readFileSync(this.paths.settings, 'utf8')))
      this.broken = false
      this.loadError = undefined
      return settings
    } catch (e) {
      this.broken = true
      this.loadError = `${this.paths.settings} 读取失败：${e instanceof Error ? e.message : String(e)}`
      return parseSettings({})
    }
  }

  getSettings(): Settings {
    this.reloadIfChanged()
    return this.settings
  }

  reload(): Settings {
    this.settings = this.readSettings()
    return this.settings
  }

  // 文件被人改过就重新读，并通知界面（窗口重新获得焦点时、每次读写设置前调用）
  reloadIfChanged(): boolean {
    if (this.fileMtime() === this.mtime) return false
    this.reload()
    this.options.onSettingsChanged?.(this.settings)
    return true
  }

  updateSettings(patch: SettingsPatch): Settings {
    // 先读一遍磁盘上的最新内容，补丁打在它上面，不用旧缓存覆盖手改的内容
    this.reloadIfChanged()
    // 补丁也要过一遍 schema，坏值不落盘
    const next = parseSettings(applySettingsPatch(this.settings, patch))
    if (this.broken && existsSync(this.paths.settings)) {
      const stamp = new Date(this.options.now?.() ?? Date.now()).toISOString().replace(/[:.]/g, '-')
      copyFileSync(this.paths.settings, `${this.paths.settings}.broken-${stamp}`)
      this.broken = false
      this.loadError = undefined
    }
    writeFileAtomic(this.paths.settings, `${JSON.stringify(next, null, 2)}\n`)
    this.mtime = this.fileMtime()
    this.settings = next
    this.options.onSettingsChanged?.(next)
    return next
  }
}
