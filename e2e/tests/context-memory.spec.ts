import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 上下文和记忆（PR16）：接近上限时提示、手动压缩后留分隔线和摘要；设置页手动加、改、删记忆。内核用 Mock。

const mock = {
  KITS_KERNEL: 'mock',
  KITS_MOCK_SCENARIO: 'done',
  KITS_MOCK_SPEED: '0.2',
}

test('offers to compact when the context is nearly full and leaves a divider with the summary', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    // Mock 这一轮用了 21.4K：窗口设成 25K，超过八成
    await page.evaluate(() =>
      window.kits.settings.update({
        gateways: [
          {
            id: 'corp',
            name: '公司网关',
            baseUrl: 'http://127.0.0.1:9/v1',
            enabled: true,
            models: [{ id: 'coder-main', note: '', contextWindow: 25_000, toolCall: true }],
          },
        ],
      }),
    )
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('给兑换接口加幂等校验')
    await box.press('Enter')
    const banner = page.getByTestId('context-banner')
    await expect(banner).toContainText('上下文已用 21K / 25K')
    await page.screenshot({ path: 'test-results/context-near.png' })

    await banner.getByRole('button', { name: '现在压缩' }).click()
    const divider = page.getByTestId('compaction')
    await expect(divider).toContainText('前面的对话已压缩成摘要')
    await expect(banner).toBeHidden()
    await divider.getByRole('button').click()
    await expect(divider).toContainText('@idempotent')
    // 上下文从摘要重新算
    await page.getByTestId('context-ring').click()
    await expect(page.getByTestId('context-usage')).toHaveText(/^1(\.2)?K \/ 25K$/)
    await expect(page.getByTestId('context')).toContainText('项目 0 条 · 个人 0 条')
    await page.screenshot({ path: 'test-results/context-compacted.png' })
  } finally {
    await close()
  }
})

test('adds, edits and removes a project memory in settings', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    await page.goto(`${page.url().split('#')[0]}#/settings/skills`)
    const memory = page.getByTestId('memory')
    await expect(memory).toContainText('还没有')

    await memory.getByRole('button', { name: '手动加一条' }).click()
    await memory.getByLabel('手动加一条').fill('测试命令是 uv run pytest')
    await memory.getByRole('button', { name: '保存' }).click()
    await expect(memory.getByTestId('memory-0')).toContainText('手动添加 · 今天')
    const file = path.join(workdir, '.agents', 'memory.md')
    expect(readFileSync(file, 'utf8')).toMatch(
      /^- 测试命令是 uv run pytest <!-- manual \d{4}-\d{2}-\d{2} -->\n$/,
    )
    await page.screenshot({ path: 'test-results/settings-memory.png' })

    await memory.getByRole('button', { name: '编辑“测试命令是 uv run pytest”' }).click()
    await memory.getByLabel('编辑').fill('测试命令是 uv run pytest -q')
    await memory.getByRole('button', { name: '保存' }).click()
    await expect(memory.getByTestId('memory-0')).toContainText('uv run pytest -q')

    await memory.getByRole('button', { name: '删除“测试命令是 uv run pytest -q”' }).click()
    await expect(memory).toContainText('还没有')
    expect(readFileSync(file, 'utf8').trim()).toBe('')

    // 个人的另存一份
    await memory.getByRole('radio', { name: '个人' }).click()
    await memory.getByRole('button', { name: '手动加一条' }).click()
    await memory.getByLabel('手动加一条').fill('回复用中文')
    await memory.getByRole('button', { name: '保存' }).click()
    await expect(memory.getByTestId('memory-0')).toContainText('回复用中文')
    expect(existsSync(path.join(configDir, 'memory.md'))).toBe(true)
  } finally {
    await close()
  }
})
