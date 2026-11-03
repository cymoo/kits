import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const main = path.resolve(import.meta.dirname, '../../apps/desktop/out/main/index.js')

test('opens the home page and reaches the main process', async () => {
  const app = await electron.launch({ args: [main] })
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('kits')
  await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
  await expect(page.getByTestId('ping')).toContainText('electron')
  await app.close()
})
