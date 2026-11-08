import { defineConfig } from '@playwright/test'

// 性能实测（perf/），不进 CI：耗时长，结果看数字不看通过与否。先 pnpm build 再跑。
export default defineConfig({
  testDir: './perf',
  workers: 1,
  reporter: 'list',
})
