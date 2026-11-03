import { copyFileSync, existsSync, readFileSync } from 'node:fs'
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
  loadError: string | undefined

  constructor(private readonly options: ConfigServiceOptions) {
    this.paths = configPaths(options.dir)
    this.settings = this.readSettings()
  }

  private readSettings(): Settings {
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
    return this.settings
  }

  // 人在编辑器里改了文件之后调用（设置页打开时、窗口重新获得焦点时）
  reload(): Settings {
    this.settings = this.readSettings()
    return this.settings
  }

  updateSettings(patch: SettingsPatch): Settings {
    // 补丁也要过一遍 schema，坏值不落盘
    const next = parseSettings(applySettingsPatch(this.settings, patch))
    if (this.broken && existsSync(this.paths.settings)) {
      const stamp = new Date(this.options.now?.() ?? Date.now()).toISOString().replace(/[:.]/g, '-')
      copyFileSync(this.paths.settings, `${this.paths.settings}.broken-${stamp}`)
      this.broken = false
      this.loadError = undefined
    }
    writeFileAtomic(this.paths.settings, `${JSON.stringify(next, null, 2)}\n`)
    this.settings = next
    this.options.onSettingsChanged?.(next)
    return next
  }
}
