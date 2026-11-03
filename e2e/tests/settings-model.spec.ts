import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { startFakeGateway } from './gateway'

// 设置 · 内核与模型（PR5）：添加网关、测试连接、选默认模型；密钥不进 settings.json。

test('adds a gateway, picks the default model and keeps the key out of settings.json', async () => {
  const gw = await startFakeGateway(['deepseek-v4-pro', 'qwen-coder'])
  const { page, configDir, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    await page.getByRole('button', { name: '添加网关' }).click()
    await page.getByLabel('名称').fill('公司网关')
    await page.getByLabel('地址').fill(gw.baseUrl)
    await page.getByLabel('API Key').fill('wrong')
    await page.getByRole('button', { name: '测试并添加' }).click()
    await expect(page.getByRole('status')).toContainText('鉴权失败')

    await page.getByLabel('API Key').fill(gw.key)
    await page.getByRole('button', { name: '测试并添加' }).click()
    const card = page.getByTestId('gateway-localhost')
    await expect(card).toContainText('公司网关')

    await card.getByRole('button', { name: /公司网关/ }).click()
    await expect(card.getByRole('radio', { name: /deepseek-v4-pro/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await card.getByRole('radio', { name: /qwen-coder/ }).click()
    await expect(card.getByRole('radio', { name: /qwen-coder/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // 单选组能用方向键切换（Radix 在按键后的下一个 tick 才移动焦点并选中，按住一小会儿像真人按键）
    await page.keyboard.press('ArrowUp', { delay: 50 })
    await expect(card.getByRole('radio', { name: /deepseek-v4-pro/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.keyboard.press('ArrowDown', { delay: 50 })
    await expect(card.getByRole('radio', { name: /qwen-coder/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await card.getByRole('button', { name: '测试', exact: true }).click()
    await expect(card.getByRole('status')).toContainText('连接正常')

    const text = readFileSync(path.join(configDir, 'settings.json'), 'utf8')
    const saved = JSON.parse(text)
    expect(saved.defaultModel).toBe('localhost/qwen-coder')
    expect(saved.gateways[0]).toMatchObject({
      id: 'localhost',
      name: '公司网关',
      baseUrl: gw.baseUrl,
    })
    expect(text).not.toContain(gw.key)
    expect(await page.evaluate(() => window.kits.secrets.has('gateway:localhost'))).toBe(true)
  } finally {
    await close()
    await gw.close()
  }
})

test('sets up the first gateway in onboarding step 1', async () => {
  const gw = await startFakeGateway(['m1', 'm2'])
  const { page, configDir, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/onboarding`)
    await page.getByLabel('网关地址').fill(gw.baseUrl)
    await page.getByLabel('API Key').fill(gw.key)
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByRole('status')).toContainText('2 个模型')
    await page.getByRole('radio', { name: 'm2' }).click()
    await expect(page.getByRole('radio', { name: 'm2' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByRole('button', { name: /工作目录/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
    const saved = JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
    expect(saved.defaultModel).toBe('localhost/m2')
  } finally {
    await close()
    await gw.close()
  }
})

test('keeps the onboarding form when the gateway lists no models', async () => {
  const gw = await startFakeGateway([])
  const { page, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/onboarding`)
    await page.getByLabel('网关地址').fill(gw.baseUrl)
    await page.getByLabel('API Key').fill(gw.key)
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByRole('status')).toContainText('没有列出任何模型')
    await expect(page.getByLabel('网关地址')).toBeVisible()
    expect(
      await page.evaluate(() => window.kits.settings.get().then((s) => s.gateways.length)),
    ).toBe(0)
  } finally {
    await close()
    await gw.close()
  }
})

test('keeps the add form in settings when the gateway lists no models', async () => {
  const gw = await startFakeGateway([])
  const { page, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    await page.getByRole('button', { name: '添加网关' }).click()
    await page.getByLabel('地址').fill(gw.baseUrl)
    await page.getByLabel('API Key').fill(gw.key)
    await page.getByRole('button', { name: '测试并添加' }).click()
    await expect(page.getByRole('status')).toContainText('没有列出任何模型')
    await expect(page.getByRole('button', { name: '测试并添加' })).toBeVisible()
    expect(
      await page.evaluate(() => window.kits.settings.get().then((s) => s.gateways.length)),
    ).toBe(0)
  } finally {
    await close()
    await gw.close()
  }
})

test('rejects an invalid gateway address before saving anything', async () => {
  const gw = await startFakeGateway(['m1'])
  const { page, close } = await launchApp()
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    await page.getByRole('button', { name: '添加网关' }).click()
    await page.getByLabel('地址').fill(gw.baseUrl)
    await page.getByLabel('API Key').fill(gw.key)
    await page.getByRole('button', { name: '测试并添加' }).click()
    const card = page.getByTestId('gateway-localhost')
    await card.getByRole('button', { name: /localhost/ }).click()
    await card.getByLabel('地址').fill('ftp://nope')
    await card.getByLabel('API Key').fill('sk-new')
    await card.getByRole('button', { name: '保存并测试' }).click()
    await expect(card.getByRole('status')).toContainText('http:// 或 https://')
    const saved = await page.evaluate(() => window.kits.settings.get())
    expect(saved.gateways[0]?.baseUrl).toBe(gw.baseUrl)
  } finally {
    await close()
    await gw.close()
  }
})

test('shows a context window changed in settings.json after the window regains focus', async () => {
  const settings = (contextWindow: number) =>
    JSON.stringify({
      onboardingDone: true,
      defaultModel: 'corp/m',
      gateways: [
        {
          id: 'corp',
          name: '公司网关',
          baseUrl: 'http://127.0.0.1:9',
          models: [{ id: 'm', contextWindow }],
        },
      ],
    })
  const { app, page, configDir, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'settings.json'), settings(128_000))
  })
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/model`)
    const card = page.getByTestId('gateway-corp')
    await card.getByRole('button', { name: /公司网关/ }).click()
    const input = card.getByLabel('m 的上下文窗口（K）')
    await expect(input).toHaveValue('128')
    writeFileSync(path.join(configDir, 'settings.json'), settings(96_000))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit('focus'))
    await expect(input).toHaveValue('96')
    // 聚焦再移开不会把旧值存回去
    await input.focus()
    await input.blur()
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8')).gateways[0]
            .models[0].contextWindow,
      )
      .toBe(96_000)
  } finally {
    await close()
  }
})

test('shows the onboarding form again when the only gateway is disabled', async () => {
  const { page, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        gateways: [
          { id: 'corp', baseUrl: 'http://127.0.0.1:9/v1', enabled: false, models: [{ id: 'm' }] },
        ],
      }),
    )
  })
  try {
    await page.goto(`${page.url().split('#')[0]}#/onboarding`)
    await expect(page.getByLabel('网关地址')).toBeVisible()
    await expect(page.getByRole('button', { name: '测试连接' })).toBeVisible()
  } finally {
    await close()
  }
})
