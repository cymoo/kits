import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// 第一张表只为了把存储链路跑通；会话、消息、产出的完整 schema 在会话模块里加。
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  agent: text('agent').notNull(),
  kernel: text('kernel').notNull(),
  workdir: text('workdir').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type Session = typeof sessions.$inferSelect
