import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话主流程（PR7）：首页输入任务 → 新建会话 → 流式回复 → 完成；停止；侧栏列表。内核用 Mock（不调模型）。

test('streams a turn from the home page to done', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await expect(page.getByText('member-svc').first()).toBeVisible()
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('给兑换接口加幂等校验')
    await box.press('Enter')

    await expect(page).toHaveURL(/#\/s\//)
    await expect(page.getByTestId('user-message')).toHaveText('给兑换接口加幂等校验')
    await expect(page.getByTestId('answer')).toContainText('改好了')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    // 完成后工作过程收起，点开能看到每一步
    const turn = page.getByTestId('turn')
    await expect(turn).toContainText('第 1 轮 · 工作过程')
    await turn.getByRole('button', { name: /第 1 轮/ }).click()
    await expect(turn.getByTestId('step').filter({ hasText: '读取文件' })).toContainText(
      'src/points/redeem.py',
    )
    // 侧栏里有这个会话
    await expect(
      page.getByTestId('session-list').getByRole('link', { name: '给兑换接口加幂等校验' }),
    ).toBeVisible()
  } finally {
    await close()
  }
})

test('stops a running turn from the header and with the shortcut', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'streaming',
    KITS_MOCK_SPEED: '3',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('慢慢做')
    await box.press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/运行中/)
    await expect(page.getByTestId('turn')).toBeVisible()
    await page.keyboard.press(`${mod}+Period`)
    await expect(page.getByTestId('session-status')).toHaveText('已停止')
    await expect(page.getByRole('button', { name: /停止/ })).toBeHidden()
  } finally {
    await close()
  }
})

test('continues the same session with a follow-up message', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.1',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await page.getByLabel('给 Agent 发消息').fill('第一轮')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成 · 1 轮/)
    const follow = page.getByLabel('给 Agent 发消息')
    await follow.fill('再来一轮')
    await follow.press('Enter')
    await expect(page.getByTestId('user-message')).toHaveCount(2)
    await expect(page.getByTestId('session-status')).toHaveText(/已完成 · 2 轮/)
  } finally {
    await close()
  }
})

test('starts another session right after one finishes', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    for (const task of ['第一个任务', '第二个任务']) {
      await page.keyboard.press(`${mod}+N`)
      // 等真的回到首页再输入，不然会打进上一个会话的输入框
      await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
      const box = page.getByLabel('给 Agent 发消息')
      await box.fill(task)
      await box.press('Enter')
      await expect(page.getByTestId('user-message')).toHaveText(task)
      await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    }
    // 记最近目录只改了设置里的 workdirs，内核不会因此重启
    const status = await page.evaluate(() => window.kits.kernel.status())
    expect(status.find((k) => k.id === 'opencode')?.state).toBe('running')
  } finally {
    await close()
  }
})

test('keeps the draft and says why when sending fails', async () => {
  const { page, configDir, close } = await launchApp({ KITS_KERNEL: 'mock' })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    // 最近用过的目录被删掉了
    rmSync(workdir, { recursive: true, force: true })
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('给兑换接口加幂等校验')
    await box.press('Enter')
    await expect(page.getByRole('alert')).toContainText('ENOENT')
    await expect(box).toHaveValue('给兑换接口加幂等校验')
    await expect(page).not.toHaveURL(/#\/s\//)
  } finally {
    await close()
  }
})
