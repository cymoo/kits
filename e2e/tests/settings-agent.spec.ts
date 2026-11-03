import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// 设置 · Agent（PR14）：三级来源的列表、复制内置的存成个人的、改权限、看转换结果；项目 Agent 进输入框的浮层。

function prepare(configDir: string) {
  const workdir = path.join(path.dirname(configDir), 'member-svc')
  mkdirSync(path.join(workdir, '.agents', 'agents'), { recursive: true })
  writeFileSync(
    path.join(workdir, '.agents', 'agents', 'api-reviewer.md'),
    '---\nname: api-reviewer\ndescription: 对照文档和实现，列出不一致\ntools: read, grep, glob\n---\n只读，不改任何文件。\n',
  )
  writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify({ workdirs: [{ path: realpathSync(workdir), lastUsedAt: 1 }] }),
  )
}

async function openAgents(page: import('@playwright/test').Page) {
  await page.goto(`${page.url().split('#')[0]}#/settings/agent`)
  await expect(page.getByTestId('agent-item-assistant')).toBeVisible()
}

test('copies the builtin assistant into a personal agent and edits its permissions', async () => {
  const { page, configDir, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    prepare(dir)
  })
  try {
    await openAgents(page)
    await expect(page.getByTestId('agent-item-api-reviewer')).toContainText('项目')
    // 内置的只读
    await expect(page.getByText('内置 · 不能改，可以复制一份改')).toBeVisible()
    await expect(page.getByLabel('提示词')).toHaveAttribute('readonly', '')
    await page.screenshot({ path: 'test-results/settings-agent.png' })

    await page.getByRole('button', { name: '复制一份' }).click()
    await page.getByRole('menuitem', { name: /个人 Agent/ }).click()
    await expect(page.getByRole('heading', { name: 'assistant-copy', level: 2 })).toBeVisible()
    await page.getByLabel('说明').fill('只看不改的助手')
    await page.getByTestId('agent-tool-bash').getByRole('radio', { name: '禁止' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()

    const file = path.join(configDir, 'agents', 'assistant-copy.md')
    await expect.poll(() => existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('description: 只看不改的助手')
    expect(text).toContain('bash: deny')
    await expect(page.getByTestId('agent-item-assistant-copy')).toContainText('个人')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  } finally {
    await close()
  }
})

test('runs a project agent on the shared base agent and offers it in the composer', async () => {
  const { page, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    prepare(dir)
  })
  try {
    await openAgents(page)
    await page.getByTestId('agent-item-api-reviewer').click()
    await expect(
      page.getByTestId('agent-tool-edit').getByRole('radio', { name: '禁止' }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: '看转换结果' }).click()
    const preview = page.getByTestId('agent-preview')
    await expect(preview).toContainText('"agent": "kits-_project"')
    await expect(preview).toContainText('只读，不改任何文件。')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '用它新建会话' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.getByTitle('Agent').click()
    await expect(page.getByRole('menuitemradio', { name: /api-reviewer/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  } finally {
    await close()
  }
})
