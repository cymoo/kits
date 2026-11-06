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
    // 完成后对话末尾没有总结卡片，改动、命令、产出看右侧面板
    await expect(page.getByText('这个会话做了什么')).toHaveCount(0)
    // 完成后工作过程收起，点开能看到每一步
    const turn = page.getByTestId('turn')
    await expect(turn).toContainText('读 1 个文件')
    await turn.getByRole('button').first().click()
    await expect(turn.getByTestId('step').filter({ hasText: '读取' })).toContainText(
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

test('stops a running turn with the composer button, which turns into queue with a draft', async () => {
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
    const stop = page.getByRole('button', { name: '停止', exact: true })
    await expect(stop).toBeVisible()
    await box.fill('顺便看下日志')
    await expect(stop).toBeHidden()
    await expect(page.getByRole('button', { name: '排队发送', exact: true })).toBeEnabled()
    await box.fill('')
    await stop.click()
    await expect(page.getByTestId('session-status')).toHaveText('已停止')
    await expect(stop).toBeHidden()
  } finally {
    await close()
  }
})

test('wraps a long unbroken user message inside the thread', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill(`D:/logs/${'very-long-path-segment-'.repeat(30)}app.log`)
    await box.press('Enter')
    const message = page.getByTestId('user-message')
    await expect(message).toBeVisible()
    const thread = page.getByRole('region', { name: '对话' })
    const [m, t] = [await message.boundingBox(), await thread.boundingBox()]
    expect((m?.x ?? 0) + (m?.width ?? 0)).toBeLessThanOrEqual((t?.x ?? 0) + (t?.width ?? 0))
    expect(await thread.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
  } finally {
    await close()
  }
})

test('shows running text inside the work process and moves the answer out at the end', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'streaming',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('慢慢做')
    await box.press('Enter')
    await expect(page.getByTestId('turn').getByTestId('live-text').first()).toBeVisible()
    await expect(page.getByTestId('answer')).toBeHidden()
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await expect(page.getByTestId('answer')).toBeVisible()
    await expect(page.getByTestId('live-text')).toBeHidden()
  } finally {
    await close()
  }
})

test('stops a running turn with the shortcut', async () => {
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
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const follow = page.getByLabel('给 Agent 发消息')
    await follow.fill('再来一轮')
    await follow.press('Enter')
    await expect(page.getByTestId('user-message')).toHaveCount(2)
    await expect(page.getByTestId('answer')).toHaveCount(2)
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
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

test('offers a jump to the bottom only after scrolling away from it', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('给兑换接口加幂等校验')
    await box.press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    for (let turn = 2; turn <= 4; turn += 1) {
      await page.getByLabel('给 Agent 发消息').fill(`第 ${turn} 个问题`)
      await page.getByLabel('给 Agent 发消息').press('Enter')
      await expect(page.getByTestId('user-message')).toHaveCount(turn)
      await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    }

    const thread = page.getByRole('region', { name: '对话' })
    const jump = page.getByRole('button', { name: '跳转至底部' })
    const distance = () => thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(distance).toBeLessThan(40)
    await expect(jump).toHaveCount(0)

    await thread.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(jump).toBeVisible()
    await page.screenshot({ path: 'test-results/jump-to-bottom.png' })

    await jump.click()
    await expect(jump).toHaveCount(0)
    await expect.poll(distance).toBeLessThan(40)
  } finally {
    await close()
  }
})

test('follows again when a taller window brings the thread back to the bottom', async () => {
  // kits 只发布 mac 和 Windows 版，Linux 上的失败还没查清
  test.skip(process.platform === 'linux', 'fails on Linux CI, see #82')
  const { app, page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('第 1 个问题')
    await box.press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    for (let turn = 2; turn <= 4; turn += 1) {
      await page.getByLabel('给 Agent 发消息').fill(`第 ${turn} 个问题`)
      await page.getByLabel('给 Agent 发消息').press('Enter')
      await expect(page.getByTestId('user-message')).toHaveCount(turn)
      // 只等状态不够：新一轮刚发出时，状态可能还是上一轮的“已完成”。回复是这一轮结束才有的
      await expect(page.getByTestId('answer')).toHaveCount(turn)
      await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    }

    const thread = page.getByRole('region', { name: '对话' })
    const jump = page.getByRole('button', { name: '跳转至底部' })
    const distance = () => thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
    await expect.poll(distance).toBeLessThan(40)
    // 这里只是准备步骤：离底部只差 100px，收尾时界面一动就可能被拉回底部（内网 Linux CI 上遇到过），
    // 被拉回去就重新滚。要验证的是下面窗口变高之后的行为
    await expect(async () => {
      await thread.evaluate((el) => {
        el.scrollTop = el.scrollHeight - el.clientHeight - 100
      })
      await expect(jump).toBeVisible({ timeout: 1_000 })
      expect(await distance()).toBeGreaterThan(60)
    }).toPass({ timeout: 15_000 })

    // 窗口变高 80px：离底部只剩 20px，scrollTop 没变，不会有 scroll 事件
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [width = 0, height = 0] = win?.getSize() ?? []
      win?.setSize(width, height + 80)
    })
    await expect(jump).toHaveCount(0)

    await page.getByLabel('给 Agent 发消息').fill('第 5 个问题')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('user-message')).toHaveCount(5)
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await expect.poll(distance).toBeLessThan(40)
  } finally {
    await close()
  }
})

test('copies any reply from the icon under it', async () => {
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
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.getByLabel('给 Agent 发消息').fill('再来一轮')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    const answers = page.getByTestId('answer')
    await expect(answers).toHaveCount(2)
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const first = answers.first().getByRole('button', { name: '复制回复' })
    const last = answers.last().getByRole('button', { name: '复制回复' })
    // 最后一条一直显示，前面的鼠标移上去才出现
    await expect(last).toHaveCSS('opacity', '1')
    await page.getByLabel('给 Agent 发消息').hover()
    await expect(first).toHaveCSS('opacity', '0')
    await answers.first().hover()
    await expect(first).toHaveCSS('opacity', '1')

    await first.click()
    await expect(answers.first().getByRole('button', { name: '已复制' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('改好了')
  } finally {
    await close()
  }
})

test('changes the permission and model of an open session from the composer', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await page.evaluate(async () => {
      const s = await window.kits.settings.get()
      const gateway = s.gateways[0]
      if (!gateway) return
      await window.kits.settings.update({
        gateways: [
          {
            ...gateway,
            models: [
              ...gateway.models,
              { id: 'coder-fast', note: '', contextWindow: 64000, toolCall: true },
            ],
          },
        ],
      })
    })
    await page.getByLabel('给 Agent 发消息').fill('开始')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    // 工作区和 Agent 改不了，输入框里不再显示
    const composer = page.getByTestId('composer')
    await expect(composer).not.toContainText('member-svc')
    await expect(composer).not.toContainText('assistant')
    await expect(composer.getByTestId('context-ring')).toBeVisible()

    await composer.getByRole('button', { name: '执行前确认' }).click()
    await page.getByRole('menuitemradio', { name: /全部自动/ }).click()
    await expect(composer.getByRole('button', { name: '全部自动' })).toBeVisible()
    await expect(page.getByTestId('notice')).toHaveText('权限改为“全部自动”，立即生效')

    await composer.getByRole('button', { name: 'coder-main' }).click()
    await expect(page.getByRole('menu')).not.toContainText('CodeAgent')
    await page.getByRole('menuitemradio', { name: 'coder-fast' }).click()
    await expect(composer.getByRole('button', { name: 'coder-fast' })).toBeVisible()
    await expect(page.getByTestId('notice').last()).toHaveText(
      '模型切换到 coder-fast，下一条消息起生效',
    )

    // 用量环打开上下文
    await composer.getByTestId('context-ring').click()
    await expect(page.getByRole('dialog', { name: '上下文' })).toBeVisible()
  } finally {
    await close()
  }
})

test('reaches the context from the ring when the model window is unknown', async () => {
  const { page, configDir, close } = await launchApp({
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'done',
    KITS_MOCK_SPEED: '0.2',
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await page.getByLabel('给 Agent 发消息').fill('开始')
    await page.getByLabel('给 Agent 发消息').press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    // 这个会话的模型从设置里删掉了，窗口大小就不知道了
    await page.evaluate(() => window.kits.settings.update({ gateways: [] }))
    const ring = page.getByTestId('context-ring')
    await expect(ring).not.toContainText('%')
    await ring.click()
    await expect(page.getByRole('dialog', { name: '上下文' })).toBeVisible()
  } finally {
    await close()
  }
})
