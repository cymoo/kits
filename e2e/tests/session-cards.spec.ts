import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 对话里要你动手的卡片（PR8）：命令确认、Agent 提问、重试条、出错卡片、运行中排队发送。内核用 Mock。

const mock = (scenario: string, speed = '0.3') => ({
  KITS_KERNEL: 'mock',
  KITS_MOCK_SCENARIO: scenario,
  KITS_MOCK_SPEED: speed,
})

async function send(page: Page, configDir: string, text: string) {
  await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  await prepare(page, configDir)
  const box = page.getByLabel('给 Agent 发消息')
  await box.fill(text)
  await box.press('Enter')
  await expect(page).toHaveURL(/#\/s\//)
}

test('allows a command once with the shortcut', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    const card = page.getByTestId('permission-card')
    await expect(card).toContainText('执行命令前需要你确认')
    await expect(card).toContainText('$ uv run pytest tests/points -q')
    await expect(card.getByRole('button', { name: /本会话允许/ })).toContainText('uv run pytest *')
    await expect(page.getByTestId('session-status')).toHaveText('等你确认')
    await page.screenshot({ path: 'test-results/permission-card.png' })
    await page.keyboard.press(`${mod}+Enter`)
    await expect(card).toBeHidden()
    await expect(page.getByTestId('answer')).toContainText('12 个测试全部通过')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const turn = page.getByTestId('turn')
    await turn.getByRole('button', { name: /第 1 轮/ }).click()
    await turn.getByTestId('step').filter({ hasText: '跑 points 的测试' }).click()
    await expect(turn.getByTestId('step-output')).toContainText('已允许')
  } finally {
    await close()
  }
})

test('follows the plan above the composer and keeps each update in the steps', async () => {
  const { page, configDir, close } = await launchApp(mock('plan'))
  try {
    await send(page, configDir, '按计划做')
    const plan = page.getByTestId('plan-card')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    await expect(plan).toContainText('1/2')
    await expect(plan.getByTestId('todo').nth(0)).toHaveAttribute('data-status', 'completed')
    await expect(plan.getByTestId('todo').nth(1)).toHaveAttribute('data-status', 'in_progress')
    await page.screenshot({ path: 'test-results/plan-card.png' })
    await plan.getByRole('button', { name: /计划/ }).click()
    await expect(plan).toContainText('跑 tests/points')
    await expect(plan.getByTestId('todo')).toHaveCount(0)
    await page.keyboard.press(`${mod}+Enter`)
    await expect(page.getByTestId('answer')).toContainText('都做完了')
    await expect(plan).toBeHidden()
    const turn = page.getByTestId('turn')
    await turn.getByRole('button', { name: /第 1 轮/ }).click()
    const update = turn.getByTestId('step').filter({ hasText: '更新计划' })
    await expect(update).toHaveCount(3)
    await update.nth(0).click()
    await expect(turn.getByTestId('step-output').getByTestId('todo').nth(0)).toHaveAttribute(
      'data-status',
      'in_progress',
    )
    await expect(update.nth(2)).toContainText('2/2')
  } finally {
    await close()
  }
})

test('rejects a command with a reason and lets the agent go on', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    const card = page.getByTestId('permission-card')
    await expect(card).toBeVisible()
    await page.keyboard.press('Escape')
    const reason = card.getByLabel('告诉 Agent 为什么不行')
    await expect(reason).toBeFocused()
    await reason.fill('测试要连测试库，先别跑')
    await reason.press('Enter')
    await expect(card).toBeHidden()
    await expect(page.getByTestId('answer')).toContainText('不跑测试了')
    const turn = page.getByTestId('turn')
    await turn.getByRole('button', { name: /第 1 轮/ }).click()
    await expect(turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })).toContainText(
      '已拒绝',
    )
  } finally {
    await close()
  }
})

test('answers a blocking question from the agent', async () => {
  const { page, configDir, close } = await launchApp(mock('question'))
  try {
    await send(page, configDir, '排查订单退款超时')
    const card = page.getByTestId('question-card')
    await expect(card).toContainText('在哪个环境复现的？')
    await expect(card).toContainText('Agent 在等你回答')
    await expect(page.getByTestId('session-status')).toHaveText('等你回答')
    await page.screenshot({ path: 'test-results/question-card.png' })
    await card.getByRole('button', { name: /预发环境/ }).click()
    await expect(card).toContainText('已回答：预发环境')
    await expect(page.getByTestId('answer')).toContainText('按这个环境查网关日志')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
  } finally {
    await close()
  }
})

test('shows the retry bar while the gateway reconnects and stops waiting on request', async () => {
  const { page, configDir, close } = await launchApp(mock('retry', '5'))
  try {
    await send(page, configDir, '生成接口文档')
    const bar = page.getByTestId('retry-bar')
    await expect(bar).toContainText('模型网关断开，正在重试')
    await expect(bar).toContainText('第 1 次')
    await bar.getByRole('button', { name: /正在重试/ }).click()
    await expect(bar).toContainText('Connection reset by server')
    await bar.getByRole('button', { name: '不等了，停在这里' }).click()
    await expect(page.getByTestId('session-status')).toHaveText(/已停止/)
    await expect(bar).toBeHidden()
  } finally {
    await close()
  }
})

test('offers to continue after the kernel process exits', async () => {
  const { page, configDir, close } = await launchApp(mock('crash'))
  try {
    await send(page, configDir, '生成积分模块接口文档')
    const card = page.getByTestId('error-card')
    await expect(card).toContainText('这一轮没有完成')
    await expect(card).toContainText('nil pointer dereference')
    await expect(card.getByRole('button', { name: '打开内核日志' })).toBeVisible()
    await page.screenshot({ path: 'test-results/error-card.png' })
    await card.getByRole('button', { name: '继续这一轮' }).click()
    await expect(page.getByTestId('user-message').nth(1)).toHaveText('继续')
    // 旧的出错卡片不再给“继续”
    await expect(page.getByTestId('error-card').first().getByRole('button')).toHaveCount(0)
  } finally {
    await close()
  }
})

test('queues a follow-up sent during a turn and sends it when the turn ends', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('顺便看下日志')
    await box.press('Enter')
    await expect(page.getByTestId('queued')).toContainText('顺便看下日志')
    await page
      .getByTestId('permission-card')
      .getByRole('button', { name: /允许一次/ })
      .click()
    await expect(page.getByTestId('user-message').nth(1)).toHaveText('顺便看下日志')
    await expect(page.getByTestId('queued')).toBeHidden()
  } finally {
    await close()
  }
})
