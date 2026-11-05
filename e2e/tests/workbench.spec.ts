import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话页右侧的面板：改动（按轮、diff 统一 / 并排、放大）；顶栏菜单和上下文对话框；对话里点开步骤看工具结果；完成时的总结卡片。内核用 Mock。

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
    const panel = page.getByRole('complementary', { name: '会话面板' })

    // 改动：一轮结束后内核算出 diff，按轮列出
    const files = panel.getByTestId('changed-files')
    await expect(files).toContainText('给兑换接口加幂等校验')
    await expect(files.getByRole('button', { name: /src\/points\/redeem\.py/ })).toBeVisible()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')
    await expect(panel.getByRole('tab', { name: /改动/ })).toContainText('1')

    await page.screenshot({ path: 'test-results/workbench-changes.png' })
    await expect(panel.getByRole('tab')).toHaveText([/改动/])

    // 命令的结果在对话里就地看：标题是模型写的描述，点开是命令、输出和允许方式
    const turn = page.getByTestId('turn')
    await turn.getByRole('button').first().click()
    const step = turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })
    await expect(step).toContainText('uv run pytest tests/points -q')
    await expect(step).toContainText('1.2 秒')
    await step.click()
    const output = turn.getByTestId('step-output')
    await expect(output).toContainText('uv run pytest tests/points -q')
    await expect(output).toContainText('12 passed')
    await expect(output).toContainText('自动允许')
    await page.screenshot({ path: 'test-results/workbench-step-output.png' })

    await page.getByTestId('context-ring').click()
    await expect(page.getByTestId('context-usage')).toHaveText('21K / 128K')
    await page.keyboard.press('Escape')

    // 改文件的步骤跳到“改动”
    await turn.getByTestId('step').filter({ hasText: '修改' }).click()
    await expect(panel.getByRole('tab', { name: /改动/ })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')

    // 面板收起时也能跳过去
    await page.getByRole('button', { name: '收起面板' }).click()
    await expect(panel).toBeHidden()
    await turn.getByTestId('step').filter({ hasText: '修改' }).click()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')

    // 键盘：聚焦步骤回车展开，再回车收起
    await step.focus()
    await page.keyboard.press('Enter')
    await expect(output).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(output).toContainText('12 passed')
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
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('radio', { name: '并排' }).click()
    await expect(panel.getByRole('radio', { name: '并排' })).toHaveAttribute('aria-checked', 'true')
    await expect(panel.getByTestId('diff')).toContainText(
      'def redeem(request_id, user_id, coupon_id):',
    )
    await page.screenshot({ path: 'test-results/workbench-wide.png' })
    // 缩回、收起、再打开
    await page.getByRole('button', { name: '缩回面板' }).click()
    await page.getByRole('button', { name: '收起面板' }).click()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '显示面板' }).click()
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
    const panel = page.getByRole('complementary', { name: '会话面板' })
    const handle = page.getByRole('separator', { name: '调整面板宽度' })
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

test('opens a failed command with the end of its output', async () => {
  const { page, configDir, close } = await launchApp(mock('command-failed'))
  try {
    await send(page, configDir, '跑一下测试')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const turn = page.getByTestId('turn')
    await expect(turn).toContainText('1 步失败')
    await turn.getByRole('button').first().click()
    await expect(turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })).toContainText(
      '退出 1',
    )
    // 失败的默认展开，只放结尾，前面的点了才有
    const output = turn.getByTestId('step-output')
    await expect(output).toContainText('1 failed, 15 passed')
    await expect(output).toContainText('0.9 秒 · 自动允许')
    await expect(output).not.toContainText('.............F..')
    await output.getByRole('button', { name: '显示前面 2 行' }).click()
    await expect(output).toContainText('.............F..')

    await output.hover()
    await output.getByRole('button', { name: '复制输出' }).click()
    await expect(output.getByRole('button', { name: '已复制' })).toBeVisible()
  } finally {
    await close()
  }
})

test('shows a command waiting for confirmation on its step', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    const turn = page.getByTestId('turn')
    const step = turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })
    await expect(step).toContainText('等待确认')
    await page
      .getByTestId('permission-card')
      .getByRole('button', { name: /本会话允许/ })
      .click()
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await turn.getByRole('button').first().click()
    await expect(step).toContainText('3.4 秒')
    await step.click()
    await expect(turn.getByTestId('step-output')).toContainText('本会话允许')
    await page.getByTestId('context-ring').click()
    await expect(page.getByTestId('allow-rules')).toContainText('uv run pytest *')
  } finally {
    await close()
  }
})

test('manages the session from the header menu', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const header = page.locator('header')
    await expect(header).toContainText('member-svc')
    const more = header.getByRole('button', { name: '更多操作' })

    await more.click()
    await page.getByRole('menuitem', { name: /查看上下文/ }).click()
    await expect(page.getByRole('dialog', { name: '上下文' })).toContainText('coder-main')
    await page.keyboard.press('Escape')

    await more.click()
    await page.getByRole('menuitem', { name: '导出 Markdown' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已导出到' })).toContainText('.md')
    const dir = path.join(userDataDir, 'exports')
    const file = readdirSync(dir).find((f) => f.endsWith('.md')) ?? ''
    expect(readFileSync(path.join(dir, file), 'utf8')).toContain('改好了')

    await more.click()
    await page.getByRole('menuitem', { name: '重命名' }).click()
    await page.getByLabel('会话标题').fill('新的标题')
    await page.getByLabel('会话标题').press('Enter')
    await expect(header.getByRole('heading', { name: '新的标题' })).toBeVisible()

    await more.click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  } finally {
    await close()
  }
})
