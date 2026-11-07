import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 自动更新：新版本下载好了在侧栏底部出标签，点开看更新内容；有会话在等人处理时不让重启。
// 设置 · 通用的“版本与更新”显示状态和正在用的更新地址。KITS_UPDATE_MOCK 用假更新，不连网。

test('shows a downloaded update in the sidebar and holds the restart while a session waits', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'permission',
    KITS_MOCK_SPEED: '0.2',
    KITS_UPDATE_MOCK: 'ready',
  })
  try {
    const badge = page.getByRole('button', { name: /新版本 .+ 已经下载好/ })
    await expect(badge).toBeVisible()
    await badge.click()
    const popover = page.getByRole('dialog', { name: /新版本/ })
    await expect(popover).toContainText('有新版本时侧栏底部提示，点开能看更新内容')
    await expect(popover).toContainText('修复')
    await expect(popover.getByRole('button', { name: '重启并更新' })).toBeEnabled()
    await page.screenshot({ path: 'test-results/update-popover.png' })
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()

    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('跑一下')
    await box.press('Enter')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    await badge.click()
    await expect(popover).toContainText('有 1 个会话在运行')
    await expect(popover.getByRole('button', { name: '重启并更新' })).toBeDisabled()
    await page.screenshot({ path: 'test-results/update-busy.png' })
  } finally {
    await close()
  }
})

test('shows the update status and the address in use in settings', async () => {
  const { page, close } = await launchApp({ KITS_UPDATE_MOCK: 'latest' })
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/general`)
    await expect(page.getByText(/已经是最新版本 · .+查过/)).toBeVisible()
    await expect(page.getByText('安装包自带')).toBeVisible()
    await expect(page.getByText('http://updates.mock/kits')).toBeVisible()
    await page.getByText('已经是最新版本').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/update-settings.png' })

    // settings.json 里写 off：不再检查，地址显示已关闭
    await page.evaluate(() => window.kits.settings.update({ updateUrl: 'off' }))
    await expect(page.getByText('自动更新已关闭')).toBeVisible()
    await expect(page.getByText('已关闭', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '检查更新' })).toHaveCount(0)
  } finally {
    await close()
  }
})
