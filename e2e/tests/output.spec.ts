import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 产出：有输出格式的 Agent 交了 JSON，对话里出现卡片，点开在右侧看，能导出。

const mock = (scenario: string) => ({
  KITS_KERNEL: 'mock',
  KITS_MOCK_SCENARIO: scenario,
  KITS_MOCK_SPEED: '0.2',
})

test('shows the JSON submitted by an agent with an output format and exports it', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(
    mock('output-structured'),
    (dir) => {
      mkdirSync(path.join(dir, 'agents'), { recursive: true })
      writeFileSync(
        path.join(dir, 'agents', 'api-reviewer.md'),
        '---\nname: api-reviewer\ndescription: 对照接口文档查实现\noutput: findings.schema.json\n---\n找出文档和实现不一致的地方。\n',
      )
      writeFileSync(
        path.join(dir, 'agents', 'findings.schema.json'),
        JSON.stringify({
          type: 'object',
          required: ['findings'],
          properties: { findings: { type: 'array' } },
        }),
      )
    },
  )
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    const id = await page.evaluate(
      (dir) =>
        window.kits.session
          .create({
            text: '对照接口文档查积分模块',
            workdir: dir,
            agent: 'api-reviewer',
            model: 'corp/coder-main',
            kernel: 'opencode',
            permissionMode: 'ask',
          })
          .then((s) => s.id),
      workdir,
    )
    await page.goto(`${page.url().split('#')[0]}#/s/${id}`)
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    // 平时没有产出页签，Agent 交了产出才有卡片
    await expect(panel.getByRole('tab', { name: '产出' })).toHaveCount(0)
    const card = page.getByTestId('output-card')
    await expect(card).toContainText('api-reviewer · 2 条')

    await card.getByRole('button', { name: '查看' }).click()
    const output = panel.getByTestId('output')
    await expect(output).toContainText('结构化结果 · JSON')
    await expect(output).toContainText('"api": "POST /points/redeem"')
    await panel.getByRole('button', { name: '关闭产出页签' }).click()
    await expect(panel.getByRole('tab', { name: '产出' })).toHaveCount(0)
    await expect(panel.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')

    // 点提交产出的步骤也能打开
    const turn = page.getByTestId('turn')
    await turn.getByRole('button').first().click()
    const submit = turn.getByTestId('step').filter({ hasText: '提交产出' })
    await expect(submit).toContainText('通过校验')
    await submit.click()
    await expect(output).toBeVisible()

    await card.getByRole('button', { name: '导出' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已导出到' })).toContainText('.json')
    const dir = path.join(userDataDir, 'exports')
    const file = readdirSync(dir).find((f) => f.endsWith('.json')) ?? ''
    expect(JSON.parse(readFileSync(path.join(dir, file), 'utf8')).findings).toHaveLength(2)
  } finally {
    await close()
  }
})
