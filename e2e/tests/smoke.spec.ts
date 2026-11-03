import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('opens the home page and reaches the main process', async () => {
  const { page, close } = await launchApp()
  try {
    await expect(page).toHaveTitle('kits')
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const info = await page.evaluate(() => window.kits.app.info())
    expect(info.electron).toMatch(/^\d+\./)
  } finally {
    await close()
  }
})
