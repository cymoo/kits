import { describe, expect, it } from 'vitest'
import { matchShortcut } from '../lib/shortcuts'
import { t } from './i18n'
import { resolveTheme } from './theme'

describe('t', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(t('palette.newWith', { q: '加幂等' })).toBe('新会话：“加幂等”')
    expect(t('settings.footer', { version: '0.1.0' })).toBe('kits 0.1.0 · 配置文件在 {dir}')
  })
})

describe('resolveTheme', () => {
  it('follows the system only when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('matchShortcut', () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, key: '', ...init }) as KeyboardEvent

  it('uses cmd on mac and ctrl elsewhere', () => {
    expect(matchShortcut(key({ metaKey: true, key: 'k' }), 'search', true)).toBe(true)
    expect(matchShortcut(key({ ctrlKey: true, key: 'k' }), 'search', true)).toBe(false)
    expect(matchShortcut(key({ ctrlKey: true, key: 'K' }), 'search', false)).toBe(true)
  })

  it('ignores the shortcut with alt held', () => {
    expect(matchShortcut(key({ metaKey: true, altKey: true, key: 'b' }), 'toggleNav', true)).toBe(
      false,
    )
  })
})
