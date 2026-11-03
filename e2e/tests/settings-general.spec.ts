import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('opens onboarding on first launch and shows what the workdir has', async () => {
  const { page, configDir, close } = await launchApp({ KITS_SKIP_ONBOARDING: '0' }, (dir) => {
    mkdirSync(dir, { recursive: true })
    const workdir = path.join(path.dirname(dir), 'member-svc')
    mkdirSync(path.join(workdir, '.agents', 'skills', 'api-testing'), { recursive: true })
    writeFileSync(path.join(workdir, 'AGENTS.md'), '# 约定\n')
    writeFileSync(
      path.join(workdir, '.agents', 'skills', 'api-testing', 'SKILL.md'),
      '---\nname: api-testing\ndescription: 接口测试\n---\n',
    )
    writeFileSync(path.join(workdir, 'pyproject.toml'), '[project]\nname = "x"\n')
    writeFileSync(path.join(workdir, 'uv.lock'), '')
    writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ workdirs: [{ path: workdir, lastUsedAt: 1 }] }),
    )
  })
  try {
    await expect(page.getByRole('heading', { name: '先把三件事配好' })).toBeVisible()
    await page.getByRole('button', { name: /工作目录/ }).click()
    const step = page.getByTestId('onboarding-workdir')
    await expect(step).toContainText('member-svc')
    await expect(step).toContainText('AGENTS.md · 会作为项目约定自动加载')
    await expect(step).toContainText('1 个项目技能：api-testing')
    await expect(step).toContainText('测试命令可能是 uv run pytest')
    await expect(step).toContainText('不是 Git 仓库')
    await page.screenshot({ path: 'test-results/onboarding-workdir.png' })
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '先跳过' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect.poll(() => settingsOf(configDir).onboardingDone).toBe(true)
  } finally {
    await close()
  }
})
