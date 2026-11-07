import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { prepare } from './session'

// 附件和 @ 引用（PR11）：上传、拖进来、附件芯片、读不了的文件、@ 工作目录里的文件。内核用 Mock。

const mock = { KITS_KERNEL: 'mock', KITS_MOCK_SCENARIO: 'done', KITS_MOCK_SPEED: '0.2' }
// 1×1 透明 PNG
const PIXEL = [
  ...Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
    'base64',
  ),
]
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

    await drop('app.exe', 'application/octet-stream')
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看这个文件')
    await box.press('Enter')
    await expect(page.getByRole('alert')).toContainText('app.exe')
    // 没发出去：草稿和附件都还在
    await expect(box).toHaveValue('看看这个文件')
    await expect(page).not.toHaveURL(/#\/s\//)
  } finally {
    await close()
  }
})

test('sends a pasted screenshot and shows it in the message', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir, [{ id: 'eye', vision: true }])
    await page.evaluate(() => window.kits.settings.update({ defaultModel: 'corp/eye' }))
    const box = page.getByLabel('给 Agent 发消息')
    await box.click()
    await box.evaluate((el, bytes) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, PIXEL)
    const chips = page.getByTestId('attachments')
    await expect(chips).toContainText('image.png')
    await expect(chips.locator('img')).toBeVisible()
    await page.screenshot({ path: 'test-results/attachments-image.png' })

    await box.fill('这张图里有什么')
    await box.press('Enter')
    await expect(page).toHaveURL(/#\/s\//)
    const thumb = page.getByTestId('message-attachments').getByRole('img', { name: 'image.png' })
    await expect(thumb).toBeVisible()
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.getByRole('button', { name: '看大图：image.png' }).click()
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')

    // 图片只存原文件，没有转出来的文字
    const id = new URL(page.url()).hash.split('/').pop() ?? ''
    const files = readdirSync(path.join(userDataDir, 'attachments', id))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/image\.png$/)

    // 重新打开会话，缩略图还在
    await page.reload()
    await expect(thumb).toBeVisible()
  } finally {
    await close()
  }
})

test('holds an image back when the model cannot see and offers a way out', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir, [{ id: 'eye', vision: true }])
    const addImage = () =>
      page.getByTestId('file-input').setInputFiles({
        name: 'shot.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PIXEL),
      })
    await addImage()
    const warning = page.getByTestId('image-warning')
    await expect(warning).toContainText('coder-main 看不了图片')
    await page.screenshot({ path: 'test-results/attachments-no-vision.png' })
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看这张图')
    await box.press('Enter')
    await expect(page).not.toHaveURL(/#\/s\//)
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()

    await warning.getByRole('button', { name: '去掉图片' }).click()
    await expect(page.getByTestId('attachments')).toBeHidden()
    await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()

    await addImage()
    await warning.getByRole('button', { name: '换成 eye' }).click()
    await expect(warning).toBeHidden()
    await box.press('Enter')
    await expect(page).toHaveURL(/#\/s\//)
    await expect(page.getByTestId('message-attachments').getByRole('img')).toBeVisible()
  } finally {
    await close()
  }
})

test('holds an image until the kernel has restarted with the new switch', async () => {
  const { page, configDir, close } = await launchApp({ ...mock, KITS_MOCK_SCENARIO: 'permission' })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('跑一下')
    await box.press('Enter')
    await expect(page.getByTestId('permission-card')).toBeVisible()

    // 任务还在跑时打开图片开关：设置已经是新的，内核还是旧配置
    await page.evaluate(async () => {
      const { gateways } = await window.kits.settings.get()
      await window.kits.settings.update({
        gateways: gateways.map((g) => ({
          ...g,
          models: g.models.map((m) => ({ ...m, vision: true })),
        })),
      })
    })
    await page.getByTestId('file-input').setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PIXEL),
    })
    await box.fill('看这张图')
    await box.press('Enter')
    await expect(page.getByRole('alert')).toContainText('内核重启后才生效')
    await expect(box).toHaveValue('看这张图')
    await expect(page.getByTestId('attachments')).toContainText('shot.png')
  } finally {
    await close()
  }
})

test('refuses a damaged image and keeps the draft', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir, [{ id: 'eye', vision: true }])
    await page.evaluate(() => window.kits.settings.update({ defaultModel: 'corp/eye' }))
    await page.getByTestId('file-input').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看这张图')
    await box.press('Enter')
    await expect(page.getByRole('alert')).toContainText('broken.png 打不开')
    await expect(box).toHaveValue('看看这张图')
    await expect(page).not.toHaveURL(/#\/s\//)
  } finally {
    await close()
  }
})

test('points to the settings when no model can see', async () => {
  const { page, configDir, close } = await launchApp(mock)
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await prepare(page, configDir)
    await page.getByTestId('file-input').setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PIXEL),
    })
    const warning = page.getByTestId('image-warning')
    await expect(warning).toContainText('还没有能看图片的模型')
    await warning.getByRole('button', { name: '去设置' }).click()
    await page.getByRole('button', { name: /公司网关/ }).click()
    await page.getByRole('switch', { name: 'coder-main 能看图片' }).click()
    await expect(page.getByRole('switch', { name: 'coder-main 能看图片' })).toBeChecked()
    await expect
      .poll(() => page.evaluate(() => window.kits.settings.get()))
      .toMatchObject({ gateways: [{ models: [{ id: 'coder-main', vision: true }] }] })
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
    await page.getByRole('menuitem', { name: /引用工作区里的文件/ }).click()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option')).toHaveCount(2)
    await box.press('Escape')
    await expect(menu).toBeHidden()
  } finally {
    await close()
  }
})
