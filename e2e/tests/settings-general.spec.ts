import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchApp } from './app'

// 设置 · 通用 / 权限 / 数据与隐私（PR17）；首次启动进引导、第 2 步工作目录。

const settingsOf = (configDir: string) =>
  JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8'))

async function open(page: Page, section: string) {
  await page.goto(`${page.url().split('#')[0]}#/settings/${section}`)
}

test('switches to the dark theme and a larger interface right away', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await open(page, 'general')
    await page.getByRole('radio', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('radio', { name: '大' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-scale', 'l')
    await page.getByRole('radio', { name: '14 px' }).click()
    await page.getByRole('switch', { name: '会话完成时发系统通知' }).click()
    await expect
      .poll(() => settingsOf(configDir).general)
      .toMatchObject({ theme: 'dark', uiScale: 'l', codeFontSize: 14, notifyOnDone: true })
    await page.getByRole('radio', { name: '标准' }).click()
    await page.screenshot({ path: 'test-results/settings-general-dark.png' })
    await page.goto(`${page.url().split('#')[0]}#/`)
    await page.screenshot({ path: 'test-results/home-dark.png' })
  } finally {
    await close()
  }
})

test('sets the default permission mode and explains where data lives', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await open(page, 'perm')
    await expect(page.getByText('git status')).toBeVisible()
    await page
      .getByRole('radiogroup', { name: '默认权限模式' })
      .getByRole('radio', { name: /^只读/ })
      .click()
    await expect.poll(() => settingsOf(configDir).permissionMode).toBe('read')
    await open(page, 'privacy')
    await expect(page.getByText('会话数据库')).toBeVisible()
    await expect(page.getByText(/kits\.db/)).toBeVisible()
  } finally {
    await close()
  }
})

test('opens onboarding on first launch and shows the git state of a chosen workdir', async () => {
  const { page, configDir, close } = await launchApp({ KITS_SKIP_ONBOARDING: '0' }, (dir) => {
    mkdirSync(dir, { recursive: true })
    const workdir = path.join(path.dirname(dir), 'member-svc')
    mkdirSync(workdir, { recursive: true })
    writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ workdirs: [{ path: workdir, lastUsedAt: 1 }] }),
    )
  })
  try {
    await expect(page.getByRole('heading', { name: '开始使用 kits' })).toBeVisible()
    const row = page.getByTestId('onboarding-workdir')
    await expect(row).toContainText('member-svc')
    await expect(row).toContainText('不是 Git 仓库')
    await page.screenshot({ path: 'test-results/onboarding-workdir.png' })
    await page.getByRole('button', { name: '先跳过' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect.poll(() => settingsOf(configDir).onboardingDone).toBe(true)
    // 已经选了目录，不再建默认目录
    expect(existsSync(path.join(path.dirname(configDir), 'kits-workspace'))).toBe(false)
  } finally {
    await close()
  }
})

test('creates the default workdir when onboarding ends without choosing one', async () => {
  const { page, configDir, close } = await launchApp({ KITS_SKIP_ONBOARDING: '0' })
  try {
    const workspace = path.join(path.dirname(configDir), 'kits-workspace')
    await expect(page.getByRole('heading', { name: '开始使用 kits' })).toBeVisible()
    await expect(page.getByTestId('onboarding-workdir')).toContainText('kits-workspace')
    // 还没开始就不建
    expect(existsSync(workspace)).toBe(false)

    await page.getByRole('button', { name: '先跳过' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    expect(existsSync(workspace)).toBe(true)
    await expect.poll(() => settingsOf(configDir).workdirs[0].path).toBe(realpathSync(workspace))
    await expect(page.getByRole('main')).toContainText('kits-workspace')
  } finally {
    await close()
  }
})
