import { defineConfig } from 'vitest/config'

// 单元测试放在被测代码旁边（foo.test.ts），每个包一个 vitest 项目。
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
