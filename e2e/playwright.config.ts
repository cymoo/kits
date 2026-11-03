import { defineConfig } from '@playwright/test'

// E2E 直接启动打包前的 Electron 应用（apps/desktop/out），先 pnpm build 再跑。
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
})
