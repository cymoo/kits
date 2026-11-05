import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话历史和搜索（PR15）：⌘K 按回复正文搜到会话、高亮命中；会话历史筛选、删除；首页建议、侧栏的全部会话。内核用 Mock。

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

test('fills a suggestion into the composer and opens all sessions from the sidebar', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await page.goto(`${page.url().split('#')[0]}#/`)

    await expect(page.getByTestId('session-list')).toContainText('给兑换接口加幂等校验')
    await page.screenshot({ path: 'test-results/home.png' })

    await page
      .getByTestId('suggestions')
      .getByRole('button', { name: /写用例/ })
      .click()
    await expect(page.getByLabel('给 Agent 发消息')).toHaveValue(/按 docs\/ 下的需求文档/)

    await page.getByRole('link', { name: '全部会话' }).click()
    await expect(page.getByRole('heading', { name: '会话', exact: true })).toBeVisible()
  } finally {
    await close()
  }
})

test('renames a session in place from its menu', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    const list = page.getByTestId('session-list')
    const open = async (title: string) => {
      await list.getByRole('link', { name: title }).hover()
      await list.getByRole('button', { name: `“${title}”的更多操作` }).click()
      await page.getByRole('menuitem', { name: '重命名' }).click()
    }

    await open('给兑换接口加幂等校验')
    const input = list.getByLabel('会话标题')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('给兑换接口加幂等校验')
    await page.screenshot({ path: 'test-results/session-rename.png' })
    await input.fill('幂等校验')
    await input.press('Enter')
    await expect(list.getByRole('link', { name: '幂等校验' })).toBeVisible()
    // 打开的会话标题跟着变
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('幂等校验')

    // Esc 放弃，清空不保存
    await open('幂等校验')
    await list.getByLabel('会话标题').fill('不要这个')
    await list.getByLabel('会话标题').press('Escape')
    await expect(list.getByRole('link', { name: '幂等校验' })).toBeVisible()
    await open('幂等校验')
    await list.getByLabel('会话标题').fill('   ')
    await list.getByLabel('会话标题').press('Enter')
    await expect(list.getByRole('link', { name: '幂等校验' })).toBeVisible()

    // 点别处也算保存
    await open('幂等校验')
    await list.getByLabel('会话标题').fill('点别处保存')
    await page.getByTestId('answer').click()
    await expect(list.getByRole('link', { name: '点别处保存' })).toBeVisible()

    await page.reload()
    await expect(list.getByRole('link', { name: '点别处保存' })).toBeVisible()
  } finally {
    await close()
  }
})

test('deletes a session after confirming and leaves its page', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await runTask(page, '排查订单退款超时')
    const list = page.getByTestId('session-list')

    // 右键行打开同一个菜单；删别的会话不离开当前页
    await list.getByRole('link', { name: '给兑换接口加幂等校验' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '删除' }).click()
    const dialog = page.getByRole('alertdialog', { name: '删除这个会话？' })
    await expect(dialog).toContainText('“给兑换接口加幂等校验”')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.screenshot({ path: 'test-results/session-remove.png' })
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(list.getByRole('link')).toHaveCount(2)

    await list.getByRole('link', { name: '给兑换接口加幂等校验' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '删除' }).click()
    await dialog.getByRole('button', { name: '删除' }).click()
    await expect(list.getByTestId('session-title')).toHaveText(['排查订单退款超时'])
    await expect(page).toHaveURL(/#\/s\//)

    // 删正在看的会话回到首页
    await list.getByRole('link', { name: '排查订单退款超时' }).hover()
    await list.getByRole('button', { name: '“排查订单退款超时”的更多操作' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await dialog.getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(page.getByText('还没有会话')).toBeVisible()
  } finally {
    await close()
  }
})

test('pins a session to the top of the sidebar and the history page', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await runTask(page, '给兑换接口加幂等校验')
    await runTask(page, '排查订单退款超时')

    const list = page.getByTestId('session-list')
    const titles = () => list.getByTestId('session-title')
    await expect(titles()).toHaveText(['排查订单退款超时', '给兑换接口加幂等校验'])
    await expect(list.getByText('置顶', { exact: true })).toHaveCount(0)

    await list.getByRole('link', { name: '给兑换接口加幂等校验' }).hover()
    await list.getByRole('button', { name: '“给兑换接口加幂等校验”的更多操作' }).click()
    await page.getByRole('menuitem', { name: '置顶' }).click()
    await expect(list.getByText('置顶', { exact: true })).toBeVisible()
    await expect(titles()).toHaveText(['给兑换接口加幂等校验', '排查订单退款超时'])
    await page.screenshot({ path: 'test-results/session-pinned.png' })

    // 重启后还在；全部会话也排在最前
    await page.reload()
    await expect(titles()).toHaveText(['给兑换接口加幂等校验', '排查订单退款超时'])
    await page.getByRole('link', { name: '全部会话' }).click()
    const history = page.getByTestId('history-list')
    await expect(history.getByRole('heading').first()).toHaveText('置顶')

    await history.getByRole('link', { name: /给兑换接口加幂等校验/ }).hover()
    await history.getByRole('button', { name: '取消置顶“给兑换接口加幂等校验”' }).click()
    await expect(history.getByRole('heading', { name: '置顶' })).toHaveCount(0)
    await expect(titles()).toHaveText(['排查订单退款超时', '给兑换接口加幂等校验'])
  } finally {
    await close()
  }
})

test('groups the sidebar by workspace and folds a group', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    await page.getByLabel('给 Agent 发消息').fill('第一个会话')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    const group = page.getByTestId('workspace').filter({ hasText: 'member-svc' })
    await expect(group.getByRole('link', { name: '第一个会话' })).toBeVisible()
    await expect(group.getByRole('link', { name: '第一个会话' })).toContainText('刚刚')

    // 当前会话所在的组不折；回到首页后才折得起来，刷新也不丢
    await page.getByRole('link', { name: '新会话' }).click()
    await group.getByRole('button', { name: 'member-svc', exact: true }).click()
    await expect(group.getByRole('link', { name: '第一个会话' })).toHaveCount(0)
    await page.reload()
    // 重开时可能回到上次的会话，组又被它撑开，回首页再看
    await page.getByRole('link', { name: '新会话' }).click()
    await expect(group.getByRole('button', { name: 'member-svc', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await group.getByRole('button', { name: 'member-svc', exact: true }).click()

    // 重命名只改显示名
    await group.getByRole('button', { name: '工作区“member-svc”的更多操作' }).click()
    await page.getByRole('menuitem', { name: '重命名' }).click()
    await page.getByLabel('工作区名称').fill('会员服务')
    await page.getByLabel('工作区名称').press('Enter')
    const renamed = page.getByTestId('workspace').filter({ hasText: '会员服务' })
    await expect(renamed).toBeVisible()
    await expect(renamed.getByRole('button', { name: '会员服务', exact: true })).toHaveAttribute(
      'title',
      workdir,
    )

    // 组标题的 + 带着这个工作区去首页
    await renamed.getByRole('button', { name: '在“会员服务”里新建会话' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  } finally {
    await close()
  }
})

test('removes a workspace together with its sessions after confirming', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await page.getByLabel('给 Agent 发消息').fill('要删的会话')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    const group = page.getByTestId('workspace').filter({ hasText: 'member-svc' })
    await group.getByRole('button', { name: '工作区“member-svc”的更多操作' }).click()
    await page.getByRole('menuitem', { name: '移除工作区' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('1 个会话')
    await expect(dialog).toContainText('member-svc')
    await dialog.getByRole('button', { name: '移除并删除 1 个会话' }).click()

    // 正看着的会话没了，回到首页
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(page.getByTestId('workspace')).toHaveCount(0)
    await expect(page.getByTestId('session-list')).not.toContainText('要删的会话')
  } finally {
    await close()
  }
})
