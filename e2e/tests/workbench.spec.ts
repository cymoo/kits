import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchApp, mod } from './app'
import { prepare } from './session'

// 会话页右侧的面板：文件在前、默认打开；改动（按轮、diff 统一 / 并排、放大）；顶栏菜单和上下文对话框；对话里点开步骤看工具结果；完成时的总结卡片。内核用 Mock。

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

test('shows the changed files, commands and usage of a finished turn', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })

    // 默认开着文件页签，改动在后面，带计数
    await expect(panel.getByRole('tab')).toHaveText(['文件', /改动/])
    await expect(panel.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByRole('tab', { name: /改动/ })).toContainText('1')
    await panel.getByRole('tab', { name: /改动/ }).click()

    // 改动：一轮结束后内核算出 diff，按轮列出
    const files = panel.getByTestId('changed-files')
    await expect(files).toContainText('给兑换接口加幂等校验')
    await expect(files.getByRole('button', { name: /src\/points\/redeem\.py/ })).toBeVisible()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')

    await page.screenshot({ path: 'test-results/workbench-changes.png' })

    // 命令的结果在对话里就地看：标题是模型写的描述，点开是命令、输出和允许方式
    const turn = page.getByTestId('turn')
    await turn.getByRole('button').first().click()
    const step = turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })
    await expect(step).toContainText('uv run pytest tests/points -q')
    await expect(step).toContainText('1.2 秒')
    await step.click()
    const output = turn.getByTestId('step-output')
    await expect(output).toContainText('uv run pytest tests/points -q')
    await expect(output).toContainText('12 passed')
    await expect(output).toContainText('自动允许')
    await page.screenshot({ path: 'test-results/workbench-step-output.png' })

    await page.getByTestId('context-ring').click()
    await expect(page.getByTestId('context-usage')).toHaveText('21K / 128K')
    await page.keyboard.press('Escape')

    // 改文件的步骤跳到“改动”
    await turn.getByTestId('step').filter({ hasText: '修改' }).click()
    await expect(panel.getByRole('tab', { name: /改动/ })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')

    // 面板收起时也能跳过去
    await page.getByRole('button', { name: '收起面板' }).click()
    await expect(panel).toBeHidden()
    await turn.getByTestId('step').filter({ hasText: '修改' }).click()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')

    // 键盘：聚焦步骤回车展开，再回车收起
    await step.focus()
    await page.keyboard.press('Enter')
    await expect(output).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(output).toContainText('12 passed')
  } finally {
    await close()
  }
})

test('widens the panel with the shortcut and shows the diff side by side', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.keyboard.press(`${mod}+Backslash`)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: /改动/ }).click()
    await panel.getByRole('radio', { name: '并排' }).click()
    await expect(panel.getByRole('radio', { name: '并排' })).toHaveAttribute('aria-checked', 'true')
    await expect(panel.getByTestId('diff')).toContainText(
      'def redeem(request_id, user_id, coupon_id):',
    )
    await page.screenshot({ path: 'test-results/workbench-wide.png' })
    // 缩回、收起、再打开
    await page.getByRole('button', { name: '缩回面板' }).click()
    await page.getByRole('button', { name: '收起面板' }).click()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '显示面板' }).click()
    await expect(panel).toBeVisible()
  } finally {
    await close()
  }
})

test('walks through several changed files and jumps from a diff to the file', async () => {
  const { page, configDir, close } = await launchApp(mock('changes'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const workdir = path.join(path.dirname(configDir), 'member-svc')
    mkdirSync(path.join(workdir, 'tests', 'points'), { recursive: true })
    writeFileSync(
      path.join(workdir, 'tests', 'points', 'test_idempotent.py'),
      'def test_same_request_id_returns_first_result():\n    pass\n',
    )
    await page.keyboard.press(`${mod}+Backslash`)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: /改动/ }).click()
    const files = panel.getByTestId('changed-files')
    const diff = panel.getByTestId('diff')

    // 五位数的行号、长行都在；方向键在文件之间换
    await files.getByRole('button', { name: /src\/points\/redeem\.py/ }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(diff).toContainText('ledger_service.py')
    await expect(diff).toContainText('10001')
    await expect(files.getByRole('button', { name: /ledger_service\.py/ })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(diff).toContainText(`${'expire_days=366;'.repeat(12)}`)

    // 删除的文件不能看、不能在文件夹里选中，只能引用
    await files.getByRole('button', { name: /legacy_cache\.py/ }).click()
    await expect(diff.getByRole('button', { name: '在对话里引用' })).toBeVisible()
    await expect(diff.getByRole('button', { name: '查看完整文件' })).toHaveCount(0)
    await expect(diff.getByRole('button', { name: '在文件夹中显示' })).toHaveCount(0)

    // 引用填进输入框；查看完整文件切到文件页签
    await files.getByRole('button', { name: /test_idempotent\.py/ }).click()
    await diff.getByRole('button', { name: '在对话里引用' }).click()
    await expect(page.getByLabel('给 Agent 发消息')).toHaveValue(
      '@tests/points/test_idempotent.py ',
    )
    await diff.getByRole('button', { name: '查看完整文件' }).click()
    await expect(panel.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByTestId('file-preview')).toContainText('def test_same_request_id')
    await page.screenshot({ path: 'test-results/workbench-diff-view-file.png' })
  } finally {
    await close()
  }
})

test('shows the diffs of the steps when the workspace is not a git repository', async () => {
  const { page, configDir, close } = await launchApp(mock('no-git'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: /改动/ }).click()
    const files = panel.getByTestId('changed-files')
    // 内核没给这一轮的 diff，结束后列表还在
    await expect(files.getByRole('button', { name: /src\/points\/redeem\.py/ })).toBeVisible()
    await expect(panel.getByTestId('diff')).toContainText('@idempotent(key="request_id")')
    // 覆盖写之后又改了一处：显示后面这处改动，并提示 diff 不完整
    await files.getByRole('button', { name: /README\.md/ }).click()
    await expect(panel.getByTestId('diff')).toContainText('# 积分模块')
    await expect(panel.getByTestId('diff')).toContainText('整个文件被重写过')
  } finally {
    await close()
  }
})

test('collapses the sidebar again when leaving the page it was expanded on', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '第一个会话')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await page.keyboard.press(`${mod}+N`)
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('第二个会话')
    await box.press('Enter')
    await expect(page.getByRole('heading', { name: '第二个会话' })).toBeVisible()

    const nav = page.getByRole('navigation', { name: '主导航' })
    await page.keyboard.press(`${mod}+Backslash`)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'false')

    // 放大工作区时切到另一个会话
    await nav.getByRole('link', { name: '第一个会话' }).click()
    await expect(page.getByRole('heading', { name: '第一个会话' })).toBeVisible()
    await expect(nav).toHaveAttribute('data-collapsed', 'true')

    // 放大的会话直接进设置页
    await page.keyboard.press(`${mod}+B`)
    await expect(nav).toHaveAttribute('data-collapsed', 'false')
    await page.keyboard.press(`${mod}+Comma`)
    await expect(page).toHaveURL(/#\/settings\/general$/)
    await expect(nav).toHaveAttribute('data-collapsed', 'true')
  } finally {
    await close()
  }
})

test('resizes the workspace panel and the chat column of the wide layout', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const panel = page.getByRole('complementary', { name: '会话面板' })
    const handle = page.getByRole('separator', { name: '调整面板宽度' })
    const before = (await panel.boundingBox())?.width ?? 0
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(before + 16)

    await page.keyboard.press(`${mod}+Backslash`)
    const chat = page.getByRole('separator', { name: '调整对话栏宽度' })
    await expect(chat).toBeVisible()
    await chat.focus()
    await page.keyboard.press('ArrowRight')
    await expect(chat).toHaveAttribute('aria-valuenow', '416')
  } finally {
    await close()
  }
})

test('opens a failed command with the end of its output', async () => {
  const { page, configDir, close } = await launchApp(mock('command-failed'))
  try {
    await send(page, configDir, '跑一下测试')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const turn = page.getByTestId('turn')
    await expect(turn).toContainText('1 步失败')
    await turn.getByRole('button').first().click()
    await expect(turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })).toContainText(
      '退出 1',
    )
    // 失败的默认展开，只放结尾，前面的点了才有
    const output = turn.getByTestId('step-output')
    await expect(output).toContainText('1 failed, 15 passed')
    await expect(output).toContainText('0.9 秒 · 自动允许')
    await expect(output).not.toContainText('.............F..')
    await output.getByRole('button', { name: '显示前面 2 行' }).click()
    await expect(output).toContainText('.............F..')

    await output.hover()
    await output.getByRole('button', { name: '复制输出' }).click()
    await expect(output.getByRole('button', { name: '已复制' })).toBeVisible()
  } finally {
    await close()
  }
})

test('shows a command waiting for confirmation on its step', async () => {
  const { page, configDir, close } = await launchApp(mock('permission'))
  try {
    await send(page, configDir, '改完跑一下测试')
    await expect(page.getByTestId('permission-card')).toBeVisible()
    const turn = page.getByTestId('turn')
    const step = turn.getByTestId('step').filter({ hasText: '跑 points 的测试' })
    await expect(step).toContainText('等待确认')
    await page
      .getByTestId('permission-card')
      .getByRole('button', { name: /本会话允许/ })
      .click()
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    await turn.getByRole('button').first().click()
    await expect(step).toContainText('3.4 秒')
    await step.click()
    await expect(turn.getByTestId('step-output')).toContainText('本会话允许')
    await page.getByTestId('context-ring').click()
    await expect(page.getByTestId('allow-rules')).toContainText('uv run pytest *')
  } finally {
    await close()
  }
})

test('manages the session from the header menu', async () => {
  const { page, configDir, userDataDir, close } = await launchApp(mock('done'))
  try {
    await send(page, configDir, '给兑换接口加幂等校验')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)
    const header = page.locator('header')
    await expect(header).toContainText('member-svc')
    const more = header.getByRole('button', { name: '更多操作' })

    // 上下文从输入框的用量环进，菜单里不重复
    await page.getByTestId('context-ring').click()
    await expect(page.getByRole('dialog', { name: '上下文' })).toContainText('coder-main')
    await page.keyboard.press('Escape')

    await more.click()
    await expect(page.getByRole('menu')).not.toContainText('上下文')
    await page.getByRole('menuitem', { name: '导出 Markdown' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已导出到' })).toContainText('.md')
    const dir = path.join(userDataDir, 'exports')
    const file = readdirSync(dir).find((f) => f.endsWith('.md')) ?? ''
    expect(readFileSync(path.join(dir, file), 'utf8')).toContain('改好了')

    await more.click()
    await page.getByRole('menuitem', { name: '重命名' }).click()
    await page.getByLabel('会话标题').fill('新的标题')
    await page.getByLabel('会话标题').press('Enter')
    await expect(header.getByRole('heading', { name: '新的标题' })).toBeVisible()

    await more.click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  } finally {
    await close()
  }
})

test('browses the workspace files and previews them', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    mkdirSync(path.join(workdir, 'src', 'points'), { recursive: true })
    writeFileSync(path.join(workdir, 'README.md'), '# 积分模块\n\n基础路径 `/api/points`\n')
    writeFileSync(path.join(workdir, 'src', 'points', 'redeem.py'), 'def redeem():\n    return 1\n')
    writeFileSync(path.join(workdir, 'orders.csv'), 'id,status\nO-1,paid\n')
    writeFileSync(path.join(workdir, 'a.bin'), Buffer.from([1, 0, 2]))
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看文件')
    await box.press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: '文件' }).click()
    const tree = panel.getByTestId('file-tree')

    // Markdown 渲染，能切源码；窄栏有返回
    await tree.getByRole('button', { name: 'README.md' }).click()
    const preview = panel.getByTestId('file-preview')
    await expect(preview.getByRole('heading', { name: '积分模块' })).toBeVisible()
    await preview.getByRole('radio', { name: '源码' }).click()
    await expect(preview.getByTestId('file-code')).toContainText('# 积分模块')
    await preview.getByRole('button', { name: '返回文件列表' }).click()

    // 目录懒加载，代码有高亮
    await tree.getByRole('button', { name: 'src' }).click()
    await tree.getByRole('button', { name: 'points' }).click()
    await tree.getByRole('button', { name: 'redeem.py' }).click()
    await expect(preview.getByTestId('file-code')).toContainText('def redeem():')
    await expect(preview.locator('[data-testid="file-code"] span[style]').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/files-code.png' })

    // 引用填进输入框
    await preview.getByRole('button', { name: '在对话里引用' }).click()
    await expect(box).toHaveValue('@src/points/redeem.py ')
    await box.fill('')
    await preview.getByRole('button', { name: '返回文件列表' }).click()

    // CSV 是表格，二进制给打开入口
    await tree.getByRole('button', { name: 'orders.csv' }).click()
    await expect(preview.getByTestId('file-table')).toContainText('O-1')
    await preview.getByRole('button', { name: '返回文件列表' }).click()
    await tree.getByRole('button', { name: 'a.bin' }).click()
    await expect(preview).toContainText('这种格式不能预览')
    await preview.getByRole('button', { name: '返回文件列表' }).click()

    // 筛选平铺结果
    await panel.getByLabel('筛选文件').fill('redeem')
    await expect(tree.getByRole('button', { name: 'src/points/redeem.py' })).toBeVisible()
    await panel.getByLabel('筛选文件').fill('')

    // 放大后左树右预览
    await page.getByRole('button', { name: '放大面板' }).click()
    await expect(panel.getByText('点左边的文件查看内容')).toBeVisible()
    await tree.getByRole('button', { name: 'README.md' }).click()
    await expect(tree).toBeVisible()
    await expect(preview.getByRole('heading', { name: '积分模块' })).toBeVisible()
  } finally {
    await close()
  }
})

test('previews images, pdf and word files', async () => {
  const { page, configDir, close } = await launchApp(mock('done'))
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const workdir = await prepare(page, configDir)
    const fixtures = path.resolve(
      import.meta.dirname,
      '../../apps/desktop/src/main/attachments/fixtures',
    )
    copyFileSync(path.join(fixtures, 'spec.pdf'), path.join(workdir, 'spec.pdf'))
    copyFileSync(path.join(fixtures, 'requirement.docx'), path.join(workdir, 'requirement.docx'))
    writeFileSync(
      path.join(workdir, 'dot.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    const box = page.getByLabel('给 Agent 发消息')
    await box.fill('看看文件')
    await box.press('Enter')
    await expect(page.getByTestId('session-status')).toHaveText(/已完成/)

    const panel = page.getByRole('complementary', { name: '会话面板' })
    await panel.getByRole('tab', { name: '文件' }).click()
    await page.getByRole('button', { name: '放大面板' }).click()
    const tree = panel.getByTestId('file-tree')
    const preview = panel.getByTestId('file-preview')

    await tree.getByRole('button', { name: 'dot.png' }).click()
    await expect
      .poll(() => preview.getByRole('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1)

    await tree.getByRole('button', { name: 'requirement.docx' }).click()
    const frame = preview.frameLocator('iframe')
    await expect(frame.locator('body')).not.toBeEmpty()

    await tree.getByRole('button', { name: 'spec.pdf' }).click()
    await expect(preview).toContainText('第 1 页，共')
    // 画出来了：canvas 上不全是白的
    await expect
      .poll(() =>
        preview.getByTestId('pdf-page').evaluate((el: HTMLCanvasElement) => {
          const { data } = el.getContext('2d')?.getImageData(0, 0, el.width, el.height) ?? {
            data: new Uint8ClampedArray(),
          }
          return data.some((v, i) => i % 4 !== 3 && v < 200)
        }),
      )
      .toBe(true)
    await page.screenshot({ path: 'test-results/files-pdf.png' })
  } finally {
    await close()
  }
})
