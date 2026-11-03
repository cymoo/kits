import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// 关窗收到托盘 / 菜单栏（PR18）：开着“关闭窗口后继续运行”时关窗只是藏起来，关掉这个设置后关窗按平台习惯走。

test('hides the window on close and keeps the app running', async () => {
  const { app, page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.isVisible()),
        ),
      )
      .toEqual([false])
    // 点程序坞图标（activate）把它叫回来
    await app.evaluate(({ app }) => app.emit('activate'))
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.isVisible()),
        ),
      )
      .toEqual([true])
  } finally {
    await close()
  }
})

test('really closes the window when keep running is off', async () => {
  const { app, page, close } = await launchApp()
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await page.evaluate(() => window.kits.settings.update({ general: { keepRunning: false } }))
    const closed = app.waitForEvent('window').catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    if (process.platform === 'darwin') {
      // macOS 上关掉最后一个窗口应用还在，点程序坞图标重新开一个
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(0)
      await app.evaluate(({ app }) => app.emit('activate'))
      await closed
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(1)
    }
  } finally {
    await close().catch(() => {})
  }
})
