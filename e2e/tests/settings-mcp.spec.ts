import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchApp } from './app'

// 设置 · MCP 服务（PR12）：粘贴识别、添加并测试、工具权限、启停、凭据、移除；输入框 + 菜单的平台开关；引导第 3 步。
// 用一个本地的 stdio MCP 服务（apps/desktop/src/main/mcp/fixtures/echo-server.mjs），用当前的 node 跑。

const echo = path.resolve(
  import.meta.dirname,
  '../../apps/desktop/src/main/mcp/fixtures/echo-server.mjs',
)
const echoConfig = JSON.stringify({
  mcpServers: { echo: { command: process.execPath, args: [echo] } },
})

async function openMcp(page: Page) {
  await page.goto(`${page.url().split('#')[0]}#/settings/mcp`)
  await expect(page.getByRole('heading', { name: 'MCP 服务', level: 2 })).toBeVisible()
}

test('adds a pasted stdio server, lists its tools and sets their permissions', async () => {
  const { page, configDir, close } = await launchApp()
  const mcpFile = () => JSON.parse(readFileSync(path.join(configDir, 'mcp.json'), 'utf8'))
  try {
    await openMcp(page)
    await page.getByRole('button', { name: '添加服务' }).click()
    await page.getByLabel('服务配置').fill(echoConfig)
    await expect(page.getByRole('status').first()).toContainText('识别到 1 个服务：echo（stdio）')
    await page.getByRole('button', { name: '添加并测试' }).click()

    const card = page.getByTestId('mcp-echo')
    await expect(card).toContainText('2 个工具')
    await expect(card.getByTestId('tool-get_case')).toContainText('读一条用例')
    // 写入类的工具默认询问
    await expect(
      card.getByTestId('tool-create_case').getByRole('radio', { name: '询问' }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/settings-mcp.png' })

    await card.getByTestId('tool-create_case').getByRole('radio', { name: '禁止' }).click()
    await expect.poll(() => mcpFile().permissions).toEqual({ 'echo.create_case': 'deny' })

    await card.getByRole('switch', { name: '启用 echo' }).click()
    await expect(card).toContainText('已停用')
    await expect.poll(() => mcpFile().enabled).toEqual({ echo: false })
    await card.getByRole('switch', { name: '启用 echo' }).click()

    await card.getByRole('button', { name: '移除' }).click()
    await expect(card).toBeHidden()
    await expect.poll(() => mcpFile()).toMatchObject({ mcpServers: {}, permissions: {} })
  } finally {
    await close()
  }
})

test('stores the token of an http server in the keychain, not in mcp.json', async () => {
  const { page, configDir, close } = await launchApp()
  try {
    await openMcp(page)
    await page.getByRole('button', { name: '添加服务' }).click()
    await page.getByLabel('服务配置').fill(
      JSON.stringify({
        mcpServers: {
          cases: {
            url: 'http://127.0.0.1:9/mcp',
            headers: { Authorization: 'Bearer ${CASE_TOKEN}' },
          },
        },
      }),
    )
    await expect(page.getByRole('status').first()).toContainText('${CASE_TOKEN}')
    await page.getByRole('button', { name: '添加并测试' }).click()
    const card = page.getByTestId('mcp-cases')
    await expect(card).toContainText('连接失败')
    await expect(card.getByRole('alert')).toContainText('还没填凭据：CASE_TOKEN')
    await expect(card).toContainText('未填')

    await card.getByLabel('填入 CASE_TOKEN，存进钥匙串').fill('secret-token')
    await card.getByRole('button', { name: '保存' }).click()
    await expect(card).toContainText('已填')
    expect(readFileSync(path.join(configDir, 'mcp.json'), 'utf8')).not.toContain('secret-token')
    expect(await page.evaluate(() => window.kits.secrets.has('env:CASE_TOKEN'))).toBe(true)
  } finally {
    await close()
  }
})

test('turns a platform off for the next session from the composer', async () => {
  const { page, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'mcp.json'), echoConfig)
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.getByRole('button', { name: '添加文件和引用' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toContainText('本次会话可用的平台')
    const echoItem = menu.getByRole('menuitemcheckbox', { name: 'echo' })
    await expect(echoItem).toHaveAttribute('aria-checked', 'true')
    await echoItem.click()
    await expect(echoItem).toHaveAttribute('aria-checked', 'false')
    // 点了不关菜单
    await expect(menu).toBeVisible()
  } finally {
    await close()
  }
})

test('connects a platform in onboarding step 3', async () => {
  const { page, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/onboarding`)
    await page.getByRole('button', { name: /MCP 服务/ }).click()
    await expect(page.getByRole('heading', { name: '连接平台（MCP）' })).toBeVisible()
    await page.getByLabel('服务配置').fill(echoConfig)
    await page.getByRole('button', { name: '添加并测试' }).click()
    await expect(page.getByTestId('onboarding-mcp')).toContainText('已连接 · 2 个工具')
    await page.getByRole('button', { name: '完成，开始使用' }).click()
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  } finally {
    await close()
  }
})
