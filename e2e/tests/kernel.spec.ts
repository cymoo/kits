import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// 内核进程（PR6）：设置页的内核状态、手动启动 / 重启、配置不全时的提示。

test('starts the mock kernel from the settings page', async () => {
  const { page, close } = await launchApp({ KITS_KERNEL: 'mock' })
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    const state = page.getByTestId('kernel-state')
    await expect(state).toHaveText('未启动（开始会话时自动启动）')
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await expect(state).toHaveText('运行中')
    // 记下这之后推来的内核状态：重启要经过“启动中”再回到“运行中”，不能是什么都没发生
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as unknown as { seen: string[] }).seen = seen
      window.kits.on('kernel.status', (s) => seen.push(s.state))
    })
    await page.getByRole('button', { name: '重启', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen))
      .toEqual(expect.arrayContaining(['stopped', 'starting', 'running']))
    await expect(state).toHaveText('运行中')
  } finally {
    await close()
  }
})

test('points at the missing settings instead of starting opencode without a gateway', async () => {
  const { page, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await expect(page.getByTestId('kernel-state')).toHaveText('出错')
    await expect(page.getByRole('alert')).toContainText('还没有启用的模型网关')
  } finally {
    await close()
  }
})
