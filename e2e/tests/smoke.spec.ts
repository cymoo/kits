import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const main = path.resolve(import.meta.dirname, '../../apps/desktop/out/main/index.js')

test('opens the home page and reaches the main process', async () => {
  // 每次用独立的用户数据目录，不碰本机真实的 kits.db
  const userData = mkdtempSync(path.join(os.tmpdir(), 'kits-e2e-'))
  const env: Record<string, string> = { KITS_USER_DATA_DIR: userData }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] ??= v
  const app = await electron.launch({ args: [main], env })
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('kits')
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    await expect(page.getByTestId('ping')).toContainText('electron')
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
