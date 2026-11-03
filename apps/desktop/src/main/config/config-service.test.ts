import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from './config-service'
import { resolveConfigDir } from './paths'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'kits-config-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveConfigDir', () => {
  it('uses KITS_CONFIG_DIR when set and ~/.kits otherwise', () => {
    expect(resolveConfigDir({ KITS_CONFIG_DIR: dir })).toBe(path.resolve(dir))
    expect(resolveConfigDir({})).toBe(path.join(os.homedir(), '.kits'))
  })
})

describe('ConfigService', () => {
  it('uses defaults without creating a file until the first save', () => {
    const config = new ConfigService({ dir })
    expect(config.getSettings().kernel).toBe('opencode')
    expect(existsSync(path.join(dir, 'settings.json'))).toBe(false)
  })

  it('merges general fields and writes pretty json', () => {
    const changed: string[] = []
    const config = new ConfigService({
      dir,
      onSettingsChanged: (s) => changed.push(s.general.theme),
    })
    config.updateSettings({ general: { theme: 'dark' } })
    const next = config.updateSettings({ general: { uiScale: 'l' }, defaultModel: 'corp/m' })
    expect(next.general).toMatchObject({ theme: 'dark', uiScale: 'l' })
    const text = readFileSync(path.join(dir, 'settings.json'), 'utf8')
    expect(JSON.parse(text)).toMatchObject({ defaultModel: 'corp/m', general: { theme: 'dark' } })
    expect(text).toContain('\n  "general"')
    expect(changed).toEqual(['dark', 'dark'])
  })

  it('rejects an invalid patch without touching the file', () => {
    const config = new ConfigService({ dir })
    expect(() => config.updateSettings({ general: { theme: 'pink' as never } })).toThrow()
    expect(existsSync(path.join(dir, 'settings.json'))).toBe(false)
  })

  it('keeps a broken file, reports it and backs it up on the next save', () => {
    writeFileSync(path.join(dir, 'settings.json'), '{ not json')
    const config = new ConfigService({ dir, now: () => Date.UTC(2026, 10, 4) })
    expect(config.loadError).toContain('settings.json')
    expect(config.getSettings().kernel).toBe('opencode')
    config.updateSettings({ general: { theme: 'light' } })
    expect(config.loadError).toBeUndefined()
    const backup = readdirSync(dir).find((f) => f.startsWith('settings.json.broken-'))
    expect(backup).toBeDefined()
    expect(readFileSync(path.join(dir, backup ?? ''), 'utf8')).toBe('{ not json')
  })

  it('clears the broken state when the broken file is deleted and settings are saved', () => {
    const file = path.join(dir, 'settings.json')
    writeFileSync(file, '{ not json')
    const config = new ConfigService({ dir })
    expect(config.loadError).toBeDefined()
    rmSync(file)
    config.updateSettings({ general: { theme: 'dark' } })
    expect(config.loadError).toBeUndefined()
    expect(JSON.parse(readFileSync(file, 'utf8')).general.theme).toBe('dark')
  })

  it('picks up a hand edit before reading and before saving', () => {
    const changed: string[] = []
    const config = new ConfigService({ dir, onSettingsChanged: (s) => changed.push(s.kernel) })
    config.updateSettings({ general: { theme: 'dark' } })
    // 编辑器里改了文件（mtime 变了）
    const file = path.join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ kernel: 'codeagent', general: { theme: 'dark' } }))
    utimesSync(file, new Date(), new Date(Date.now() + 5_000))
    expect(config.getSettings().kernel).toBe('codeagent')
    expect(changed.at(-1)).toBe('codeagent')
    // 保存补丁时打在手改后的内容上，不用旧缓存覆盖
    const next = config.updateSettings({ general: { uiScale: 's' } })
    expect(next.kernel).toBe('codeagent')
  })
})
