import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, mod } from './app'

// 外壳：侧栏、⌘K 面板、快捷键、设置读写（phase1-implementation PR4）。

test('jumps to a settings section from the command palette', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+K`)
    const dialog = page.getByRole('dialog', { name: '搜索和跳转' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('内核')
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await page.screenshot({ path: 'test-results/palette.png' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: '内核与模型', level: 2 })).toBeVisible()
    expect(new URL(page.url()).hash).toBe('#/settings/model')
  } finally {
    await close()
  }
})

test('collapses the sidebar with the shortcut and remembers it', async () => {
  const { page, close } = await launchApp()
  try {
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
    await page.reload()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
  } finally {
    await close()
  }
})

test('saves settings to the config dir and applies the theme', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.evaluate(() => window.kits.settings.update({ general: { theme: 'dark' } }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const saved = JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
    expect(saved.general.theme).toBe('dark')
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page.getByTestId('settings-footer')).toContainText(configDir)
    await expect(page.getByTestId('settings-footer')).toContainText('kits 0.1.0')
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/settings-dark.png' })
  } finally {
    await close()
  }
})

test('warns about a broken settings file on the settings page', async () => {
  const { page, configDir, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'settings.json'), '{ not json')
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page.getByRole('alert')).toContainText(path.join(configDir, 'settings.json'))
  } finally {
    await close()
  }
})

test('opens the command palette with an empty query after running an action', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+K`)
    await page.keyboard.type('内核')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '搜索和跳转' })).toBeHidden()
    await page.keyboard.press(`${mod}+K`)
    const input = page.getByRole('combobox', { name: '搜索' })
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('aria-activedescendant', 'palette-new')
  } finally {
    await close()
  }
})
