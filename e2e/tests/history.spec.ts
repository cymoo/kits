import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话历史和搜索（PR15）：⌘K 按回复正文搜到会话、高亮命中；会话历史筛选、删除；首页建议和“继续上次”。内核用 Mock。

const mock = {
  KITS_KERNEL: 'mock',
  KITS_MOCK_SCENARIO: 'done',
  KITS_MOCK_SPEED: '0.2',
}

async function runTask(page: Page, text: string) {
  await page.goto(`${page.url().split('#')[0]}#/`)
  const box = page.getByLabel('给 Agent 发消息')
  await box.fill(text)
  await box.press('Enter')
  await expect(page).toHaveURL(/#\/s\//)
  await expect(page.getByText('跑一下 tests/points 确认没有回归')).toBeVisible()
}

test('finds a session by its reply text from the palette and opens it', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await runTask(page, '排查订单退款超时')

    await page.keyboard.press(`${mod}+k`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').fill('idempotent')
    const hits = dialog.getByRole('option').filter({ has: page.locator('mark') })
    await expect(hits).toHaveCount(2)
    await expect(hits.first().locator('mark')).toHaveText('idempotent')
    await page.screenshot({ path: 'test-results/palette-search.png' })

    // 两个字走 LIKE：只命中标题里有“退款”的那个
    await dialog.getByRole('combobox').fill('退款')
    await expect(dialog.getByRole('option', { name: /排查订单退款超时/ })).toBeVisible()
    await expect(dialog.getByRole('option', { name: /幂等校验/ })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '排查订单退款超时' })).toBeVisible()
  } finally {
    await close()
  }
})

test('filters and removes sessions on the history page', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await runTask(page, '排查订单退款超时')

    await page.goto(`${page.url().split('#')[0]}#/history`)
    const list = page.getByTestId('history-list')
    await expect(list.getByRole('link')).toHaveCount(2)
    await expect(page.getByText('本机共 2 个')).toBeVisible()
    await page.screenshot({ path: 'test-results/history.png' })

    await page.getByRole('button', { name: '进行中' }).click()
    await expect(page.getByText('没有符合条件的会话')).toBeVisible()
    await page.getByRole('button', { name: '已完成' }).click()
    await expect(list.getByRole('link')).toHaveCount(2)

    const row = list.getByRole('link', { name: /排查订单退款超时/ })
    await row.hover()
    await page.getByRole('button', { name: '删除“排查订单退款超时”' }).click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(list.getByRole('link')).toHaveCount(1)
    // 侧栏也跟着少了
    await expect(page.getByTestId('session-list')).not.toContainText('排查订单退款超时')
  } finally {
    await close()
  }
})

test('fills a suggestion into the composer and shows recent sessions to continue', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await page.goto(`${page.url().split('#')[0]}#/`)

    const cards = page.getByTestId('continue-cards')
    await expect(cards.getByRole('link')).toHaveCount(1)
    await expect(cards).toContainText('给兑换接口加幂等校验')
    await expect(cards).toContainText('已完成')
    await page.screenshot({ path: 'test-results/home.png' })

    await page
      .getByTestId('suggestions')
      .getByRole('button', { name: /写用例/ })
      .click()
    await expect(page.getByLabel('给 Agent 发消息')).toHaveValue(/按 docs\/ 下的需求文档/)
  } finally {
    await close()
  }
})
