import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话页右侧的工作区面板（PR9）：改动（按轮、diff 统一 / 并排、放大）、命令、上下文；完成时的总结卡片。内核用 Mock。

const mock = (scenario: string) => ({
  KITS_KERNEL: 'mock',
  KITS_MOCK_SCENARIO: scenario,
  KITS_MOCK_SPEED: '0.2',
})

async function send(page: Page, configDir: string, text: string) {
  await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  await prepare(page, configDir)
  const box = page.getByLabel('给 Agent 发消息')
  await box.fill(text)
  await box.press('Enter')
  await expect(page).toHaveURL(/#\/s\//)
}

test('shows the changed files, commands and usage of a finished turn', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '工作区面板' })

    // 改动：一轮结束后内核算出 diff，按轮列出
    const files = panel.getByTestId('changed-files')
    await expect(files).toContainText('第 1 轮')
    await expect(files.getByRole('button', { name: /src\/points\/redeem\.py/ })).toBeVisible()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')
    await expect(panel.getByRole('tab', { name: /改动/ })).toContainText('1')

    // 总结卡片：点“命令”跳到命令页签
    const summary = page.getByTestId('summary')
    await expect(summary).toContainText('1 个文件')
    await expect(summary).toContainText('都成功了')
    await page.screenshot({ path: 'test-results/workbench-changes.png' })
    await summary.getByRole('button', { name: /命令/ }).click()
    const command = panel.getByTestId('command')
    await expect(command).toContainText('uv run pytest tests/points -q')
    await expect(command).toContainText('退出 0')
    await expect(command).toContainText('1.2 秒 · 自动允许')
    await expect(command).toContainText('12 passed')

    await panel.getByRole('tab', { name: '上下文' }).click()
    await expect(panel.getByTestId('context-usage')).toHaveText('21K / 128K')
  } finally {
    await close()
  }
})

test('widens the panel with the shortcut and shows the diff side by side', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.keyboard.press(`${mod}+Backslash`)
    const panel = page.getByRole('complementary', { name: '工作区面板' })
    await panel.getByRole('radio', { name: '并排' }).click()
    await expect(panel.getByRole('radio', { name: '并排' })).toHaveAttribute('aria-checked', 'true')
    await expect(panel.getByTestId('diff')).toContainText(
      'def redeem(request_id, user_id, coupon_id):',
    )
    await page.screenshot({ path: 'test-results/workbench-wide.png' })
    // 缩回、收起、再打开
    await page.getByRole('button', { name: '缩回工作区面板' }).click()
    await page.getByRole('button', { name: '收起工作区面板' }).click()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '显示工作区面板' }).click()
    await expect(panel).toBeVisible()
  } finally {
    await close()
  }
})

test('lists a command waiting for confirmation in the commands tab', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    const panel = page.getByRole('complementary', { name: '工作区面板' })
    await panel.getByRole('tab', { name: /命令/ }).click()
    await expect(panel.getByTestId('command')).toContainText('等待确认')
    await page
      .getByTestId('permission-card')
      .getByRole('button', { name: /本会话允许/ })
      .click()
    await expect(panel.getByTestId('command')).toContainText('退出 0')
    await expect(panel.getByTestId('command')).toContainText('本会话允许')
    await expect(panel.getByTestId('terminal')).toContainText('uv run pytest *')
  } finally {
    await close()
  }
})
