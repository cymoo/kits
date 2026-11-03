import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 附件和 @ 引用（PR11）：上传、拖进来、附件芯片、读不了的文件、@ 工作目录里的文件。内核用 Mock。

const mock = { KITS_KERNEL: 'mock', KITS_MOCK_SCENARIO: 'done', KITS_MOCK_SPEED: '0.2' }
const docx = path.resolve(
  import.meta.dirname,
  '../../apps/desktop/src/main/attachments/fixtures/requirement.docx',
)

test('uploads a Word file and a markdown file with the first task', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    // 路径和内存里的文件不能混着传，分两次加
    await page.getByTestId('file-input').setInputFiles(docx)
    await page.getByTestId('file-input').setInputFiles({
      name: '用例.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 用例\n- 正常兑换\n'),
    })
    const chips = page.getByTestId('attachments')
    await expect(chips).toContainText('requirement.docx')
    await expect(chips).toContainText('用例.md')
    await chips.getByRole('button', { name: '去掉 用例.md' }).click()
    await expect(chips).not.toContainText('用例.md')
    await page.getByTestId('file-input').setInputFiles({
      name: '用例.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 用例\n- 正常兑换\n'),
    })
    await page.screenshot({ path: 'test-results/attachments-composer.png' })

    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('按需求补测试')
    await box.press('Enter')
    await expect(page).toHaveURL(/#\/s\//)
    const sent = page.getByTestId('message-attachments')
    await expect(sent).toContainText('requirement.docx')
    await expect(sent).toContainText('用例.md')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    // 原文件和转出来的文字都存在 {userData}/attachments/<会话>/
    const id = new URL(page.url()).hash.split('/').pop() ?? ''
    const dir = path.join(userDataDir, 'attachments', id)
    await expect.poll(() => existsSync(dir)).toBe(true)
    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.txt'))).toHaveLength(2)
  } finally {
    await close()
  }
})

test('adds a file dropped on the composer and refuses one it cannot read', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const drop = async (name: string, type: string) => {
      const data = await page.evaluateHandle(
        ([n, t]) => {
          const dt = new DataTransfer()
          dt.items.add(new File(['hello'], n as string, { type: t as string }))
          return dt
        },
        [name, type],
      )
      const target = page.getByLabel('给 Agent 发消息')
      await target.dispatchEvent('dragover', { dataTransfer: data })
      await target.dispatchEvent('drop', { dataTransfer: data })
    }
    await drop('notes.txt', 'text/plain')
    await expect(page.getByTestId('attachments')).toContainText('notes.txt')

    await drop('shot.png', 'image/png')
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看这张图')
    await box.press('Enter')
    await expect(page.getByRole('alert')).toContainText('shot.png')
    // 没发出去：草稿和附件都还在
    await expect(box).toHaveValue('看看这张图')
    await expect(page).not.toHaveURL(/#\/s\//)
  } finally {
    await close()
  }
})

test('references a file of the workdir with @', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    mkdirSync(path.join(workdir, 'src', 'points'), { recursive: true })
    writeFileSync(path.join(workdir, 'src', 'points', 'redeem.py'), '')
    writeFileSync(path.join(workdir, 'src', 'points', 'refund.py'), '')
    mkdirSync(path.join(workdir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(path.join(workdir, 'node_modules', 'x', 'redeem.js'), '')

    const box = page.getByLabel('给 Agent 发消息')
    await box.click()
    await box.pressSequentially('看下 @red')
    const menu = page.getByTestId('at-menu')
    await expect(menu.getByRole('option')).toHaveText(['src/points/redeem.py'])
    await page.screenshot({ path: 'test-results/attachments-at.png' })
    await box.press('Enter')
    await expect(menu).toBeHidden()
    await expect(box).toHaveValue('看下 @src/points/redeem.py ')

    // + 菜单里的“引用文件”也能打开它
    await page.getByRole('button', { name: '添加文件和引用' }).click()
    await page.getByRole('menuitem', { name: /引用工作目录里的文件/ }).click()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option')).toHaveCount(2)
    await box.press('Escape')
    await expect(menu).toBeHidden()
  } finally {
    await close()
  }
})
