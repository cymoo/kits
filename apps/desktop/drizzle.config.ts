import { defineConfig } from 'drizzle-kit'

// 只用来生成迁移文件（pnpm db:generate），运行时由主进程执行 drizzle/ 里的 SQL。
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
})
