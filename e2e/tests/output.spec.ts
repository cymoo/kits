import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 产出面板（PR10）：回复正文可以改、自动保存、还原、导出 Markdown；有输出格式的 Agent 交的 JSON 能看能导出。内核用 Mock。

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

test('edits the reply, keeps the AI draft apart and exports the edited markdown', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: /产出/ }).click()
    const editor = panel.getByLabel('产出内容')
    await expect(editor).toHaveValue(/改好了/)
    // 光标放到末尾（mac 的 textarea 不认 ⌘End）
    await editor.evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    await editor.pressSequentially('\n\n补一句：老调用方不传请求号也能用。')
    await expect(panel.getByTestId('output')).toContainText('改了 1 处')
    await expect(panel.getByTestId('output')).toContainText('回复正文 · Markdown · 已编辑')
    await page.screenshot({ path: 'test-results/output-text.png' })

    // 原稿和修改分开存
    const [saved] = await page.evaluate(async () => {
      const id = location.hash.split('/').pop() ?? ''
      return window.kits.output.list(id)
    })
    expect(saved?.edited).toMatch(/改好了[\s\S]*老调用方不传请求号也能用。$/)
    expect(saved?.aiDraft).not.toContain('老调用方')

    await panel.getByRole('button', { name: '导出' }).click()
    await page.getByRole('menuitem', { name: '导出 Markdown 文件' }).click()
    await expect(panel.getByRole('status')).toContainText('已导出到')
    const dir = path.join(userDataDir, 'exports')
    await expect.poll(() => existsSync(dir)).toBe(true)
    const file = readdirSync(dir).find((f) => f.endsWith('.md')) ?? ''
    expect(readFileSync(path.join(dir, file), 'utf8')).toContain('老调用方不传请求号也能用')

    await panel.getByRole('button', { name: '还原为 AI 原稿' }).click()
    await expect(editor).not.toHaveValue(/老调用方/)
    await expect(panel.getByTestId('output')).not.toContainText('已编辑')
  } finally {
    await close()
  }
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
    const turn = page.getByTestId('turn')
    await turn.getByRole('button').first().click()
    const submit = turn.getByTestId('step').filter({ hasText: '提交产出' })
    await expect(submit).toContainText('通过校验')
    await submit.click()
    const output = panel.getByTestId('output')
    await expect(output).toContainText('结构化结果 · JSON')
    await expect(output).toContainText('"api": "POST /points/redeem"')
    await panel.getByRole('button', { name: '导出' }).click()
    await page.getByRole('menuitem', { name: '导出 JSON 文件' }).click()
    await expect(panel.getByRole('status')).toContainText('.json')
    const dir = path.join(userDataDir, 'exports')
    const file = readdirSync(dir).find((f) => f.endsWith('.json')) ?? ''
    expect(JSON.parse(readFileSync(path.join(dir, file), 'utf8')).findings).toHaveLength(2)
  } finally {
    await close()
  }
})

test('exports and reverts right after typing without losing or resurrecting edits', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: '产出' }).click()
    const editor = panel.getByLabel('产出内容')
    const draft = await editor.inputValue()
    const atEnd = () =>
      editor.evaluate((el: HTMLTextAreaElement) => {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })

    // 打完字马上导出（自动保存还没到时间）：导出的是最新内容
    await atEnd()
    await editor.pressSequentially('\n刚打的字')
    await panel.getByRole('button', { name: '导出' }).click()
    await page.getByRole('menuitem', { name: '导出 Markdown 文件' }).click()
    await expect(panel.getByRole('status')).toContainText('已导出到')
    const dir = path.join(userDataDir, 'exports')
    const file = readdirSync(dir).find((f) => f.endsWith('.md')) ?? ''
    expect(readFileSync(path.join(dir, file), 'utf8')).toContain('刚打的字')

    // 再打几个字马上还原：还没存的那次自动保存不会把它写回来
    await atEnd()
    await editor.pressSequentially('又改了')
    await panel.getByRole('button', { name: '还原为 AI 原稿' }).click()
    await expect(editor).toHaveValue(draft)
    await page.waitForTimeout(900)
    await expect(editor).toHaveValue(draft)
    const [saved] = await page.evaluate(() =>
      window.kits.output.list(location.hash.split('/').pop() ?? ''),
    )
    expect(saved?.edited).toBeNull()
  } finally {
    await close()
  }
})
