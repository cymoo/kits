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

    await page.screenshot({ path: 'test-results/workbench-changes.png' })
    await panel.getByRole('tab', { name: /命令/ }).click()
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

test('collapses the sidebar again when leaving the page it was expanded on', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '第一个会话')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.keyboard.press(`${mod}+N`)
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('第二个会话')
    await box.press('Enter')
    await expect(page.getByRole('heading', { name: '第二个会话' })).toBeVisible()

    const nav = page.getByRole('navigation', { name: '主导航' })
    await page.keyboard.press(`${mod}+Backslash`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'false')

    // 放大工作区时切到另一个会话
    await nav.getByRole('link', { name: '第一个会话' }).click()
    await expect(page.getByRole('heading', { name: '第一个会话' })).toBeVisible()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')

    // 放大的会话直接进设置页
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page).toHaveURL(/#\/settings\/general$/)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
  } finally {
    await close()
  }
})

test('resizes the workspace panel and the chat column of the wide layout', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '工作区面板' })
    const handle = page.getByRole('separator', { name: '调整工作区面板宽度' })
    const before = (await panel.boundingBox())?.width ?? 0
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(before + 16)

    await page.keyboard.press(`${mod}+Backslash`)
    const chat = page.getByRole('separator', { name: '调整对话栏宽度' })
    await expect(chat).toBeVisible()
    await chat.focus()
    await page.keyboard.press('ArrowRight')
    await expect(chat).toHaveAttribute('aria-valuenow', '416')
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
