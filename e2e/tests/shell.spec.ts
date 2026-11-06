import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 外壳：侧栏、⌘K 面板、快捷键、设置读写（phase1-implementation PR4）。

test('jumps to a settings section from the command palette', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+K`)
    const dialog = page.getByRole('dialog', { name: '搜索和跳转' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('内核')
    await expect(dialog.getByRole('option')).toHaveCount(2)
    await page.screenshot({ path: 'test-results/palette.png' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: '内核与模型', level: 2 })).toBeVisible()
    expect(new URL(page.url()).hash).toBe('#/settings/model')
  } finally {
    await close()
  }
})

test('collapses the sidebar with the shortcut and remembers it', async () => {
  const { page, close } = await launchApp()
  try {
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
    await page.reload()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
  } finally {
    await close()
  }
})

test('saves settings to the config dir and applies the theme', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.evaluate(() => window.kits.settings.update({ general: { theme: 'dark' } }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const saved = JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
    expect(saved.general.theme).toBe('dark')
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page.getByTestId('settings-footer')).toContainText(configDir)
    await expect(page.getByTestId('settings-footer')).toContainText('kits 0.1.0')
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/settings-dark.png' })
  } finally {
    await close()
  }
})

test('warns about a broken settings file on the settings page', async () => {
  const { page, configDir, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'settings.json'), '{ not json')
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page.getByRole('alert')).toContainText(path.join(configDir, 'settings.json'))
  } finally {
    await close()
  }
})

test('opens the command palette with an empty query after running an action', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+K`)
    await page.keyboard.type('内核')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '搜索和跳转' })).toBeHidden()
    await page.keyboard.press(`${mod}+K`)
    const input = page.getByRole('combobox', { name: '搜索' })
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('aria-activedescendant', 'palette-new')
  } finally {
    await close()
  }
})

test('closes the command palette when a shortcut jumps to another page', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.keyboard.press(`${mod}+K`)
    const dialog = page.getByRole('dialog', { name: '搜索和跳转' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press(`${mod}+Comma`)
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/#\/settings\/general$/)
  } finally {
    await close()
  }
})

test('expands the sidebar on the settings page and restores it after leaving', async () => {
  const { page, close } = await launchApp()
  try {
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(nav).toHaveAttribute('data-collapsed', 'false')

    await page.keyboard.press(`${mod}+Comma`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
    await nav.getByRole('button', { name: '展开侧栏' }).click()
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.getByRole('link', { name: 'MCP 服务' }).click()
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await nav.getByRole('button', { name: '折叠侧栏' }).click()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')

    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await nav.getByRole('link', { name: '新会话' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')

    // 记住折叠后再进设置，展开只管这一页，出来还是折叠
    await page.keyboard.press(`${mod}+Comma`)
    await nav.getByRole('button', { name: '展开侧栏' }).click()
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await nav.getByRole('link', { name: '新会话' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
  } finally {
    await close()
  }
})

test('resizes the sidebar by dragging, remembers it and resets on double click', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主导航' })
    const handle = page.getByRole('separator', { name: '调整侧栏宽度' })
    const width = async () => (await nav.boundingBox())?.width
    expect(await width()).toBe(248)

    const box = await handle.boundingBox()
    if (!box) throw new Error('没有手柄')
    await page.mouse.move(box.x + 4, box.y + 300)
    await page.mouse.down()
    await page.mouse.move(box.x + 64, box.y + 300, { steps: 5 })
    await page.mouse.up()
    await expect.poll(width).toBe(308)

    // 键盘也能调
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(width).toBe(324)

    await page.reload()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect.poll(width).toBe(324)

    await handle.dblclick()
    await expect.poll(width).toBe(248)
  } finally {
    await close()
  }
})

test('clears the drag state when the sidebar collapses in the middle of a drag', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const handle = page.getByRole('separator', { name: '调整侧栏宽度' })
    const box = await handle.boundingBox()
    if (!box) throw new Error('没有手柄')
    const root = page.locator('html')
    await page.mouse.move(box.x + 4, box.y + 300)
    await page.mouse.down()
    await page.mouse.move(box.x + 24, box.y + 300, { steps: 2 })
    await expect(root).toHaveAttribute('data-resizing', '')

    await page.keyboard.press(`${mod}+B`)
    await expect(handle).toBeHidden()
    await page.mouse.up()
    await expect(root).not.toHaveAttribute('data-resizing')
  } finally {
    await close()
  }
})

test('keeps the slash and at menus inside a short window on the home page', async () => {
  const { app, page, configDir, close } = await launchApp({}, (dir) => {
    // 技能和文件够多，菜单才会长到放不下
    for (let i = 0; i < 14; i++) {
      const skill = path.join(dir, 'skills', `a-long-skill-name-for-the-menu-${i}`)
      mkdirSync(skill, { recursive: true })
      writeFileSync(
        path.join(skill, 'SKILL.md'),
        `---\nname: a-long-skill-name-for-the-menu-${i}\ndescription: 占位\n---\n`,
      )
    }
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    for (let i = 0; i < 14; i++) writeFileSync(path.join(workdir, `file-${i}.md`), '')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 600))

    const box = page.getByLabel('给 Agent 发消息')
    await box.click()
    await box.pressSequentially('/')
    const slash = page.getByTestId('slash-menu')
    await expect(slash).toContainText('/a-long-skill-name-for-the-menu-0')
    await expect(slash).toBeInViewport({ ratio: 1 })
    await expect(slash.getByText('技能', { exact: false }).first()).toBeInViewport({ ratio: 1 })

    await box.fill('')
    await box.pressSequentially('@file')
    const at = page.getByTestId('at-menu')
    await expect(at.getByRole('option').first()).toBeVisible()
    await expect(at).toBeInViewport({ ratio: 1 })
  } finally {
    await close()
  }
})

test('keeps the option picked with the arrow keys in view at the large ui scale', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.evaluate(() => window.kits.settings.update({ general: { uiScale: 'l' } }))
    await page.keyboard.press(`${mod}+K`)
    const options = page.getByRole('dialog', { name: '搜索和跳转' }).getByRole('option')
    const n = await options.count()
    for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown')
    await expect(options.last()).toHaveAttribute('aria-selected', 'true')
    // 没滚过去时比例是 0；留一点余量给亚像素
    await expect(options.last()).toBeInViewport({ ratio: 0.9 })
    await expect(page.getByRole('combobox', { name: '搜索' })).toBeFocused()
  } finally {
    await close()
  }
})

test('switches the kernel in the composer model menu with the keyboard', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.getByTitle('内核与模型').focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    const codeagent = menu.getByRole('menuitemradio', { name: 'CodeAgent' })
    await expect(menu.getByRole('menuitemradio', { name: 'OpenCode' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(codeagent).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(codeagent).toHaveAttribute('aria-checked', 'true')
    // 选了内核菜单不关，接着选模型
    await expect(menu).toBeVisible()
  } finally {
    await close()
  }
})

test('puts the cursor in the composer when starting a new session', async () => {
  const { page, close } = await launchApp()
  try {
    const box = page.getByLabel('给 Agent 发消息')
    await expect(box).toBeFocused()

    // 从别的页面回来
    await page.getByRole('link', { name: '全部会话' }).click()
    await expect(box).toHaveCount(0)
    await page.getByRole('link', { name: '新会话' }).click()
    await expect(box).toBeFocused()

    // 已经在首页，焦点跑到别处了
    await page.getByRole('button', { name: /搜索/ }).focus()
    await page.getByRole('link', { name: '新会话' }).click()
    await expect(box).toBeFocused()
  } finally {
    await close()
  }
})

test('keeps each permission note on one line', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByTitle('权限').click()
    const note = page.getByRole('menuitemradio', { name: /智能/ }).locator('small')
    const { height, lineHeight } = await note.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
    }))
    expect(height).toBeLessThan(lineHeight * 1.5)
  } finally {
    await close()
  }
})
