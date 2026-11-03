import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// 会话存储（phase1-implementation 5.4 节）。会话流的唯一来源：界面打开会话时从这里读，运行中的增量也先写这里再推给界面。
// 全文搜索（sessions_fts）在 PR15 加。

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    agent: text('agent').notNull(),
    kernel: text('kernel').notNull(),
    // 内核里的会话 id；第一轮开始前为空
    kernelSessionId: text('kernel_session_id'),
    workdir: text('workdir').notNull(),
    // `<网关 id>/<模型 id>`
    model: text('model').notNull().default(''),
    permissionMode: text('permission_mode').notNull().default('ask'),
    // running / waiting / done / error / aborted
    status: text('status').notNull().default('running'),
    turns: integer('turns').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // 给已有的行加列时要有默认值
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`0`),
    lastError: text('last_error'),
  },
  (t) => [index('sessions_updated_at').on(t.updatedAt)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // user / assistant
    role: text('role').notNull(),
    turn: integer('turn').notNull(),
    // 用户消息的正文直接放这里；助手消息的内容在 parts
    text: text('text').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // completed / aborted / error / max-steps
    finishReason: text('finish_reason'),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    tokensCacheRead: integer('tokens_cache_read').notNull().default(0),
    tokensCacheWrite: integer('tokens_cache_write').notNull().default(0),
    cost: real('cost').notNull().default(0),
  },
  (t) => [index('messages_session').on(t.sessionId, t.turn)],
)

export const parts = sqliteTable(
  'parts',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // 同一条消息里的顺序
    seq: integer('seq').notNull(),
    // text / reasoning / tool / permission / question / retry / compaction
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    // tool：running / completed / error；permission：pending / once / always / reject；其他为空
    status: text('status'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('parts_message').on(t.messageId, t.seq)],
)

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  textPath: text('text_path'),
})

export const outputs = sqliteTable('outputs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  // text / structured
  kind: text('kind').notNull(),
  // AI 原稿和人工修改分开存，导出评测数据时用
  aiDraft: text('ai_draft', { mode: 'json' }),
  edited: text('edited', { mode: 'json' }),
  editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  exportedAt: integer('exported_at', { mode: 'timestamp_ms' }),
  exportFormat: text('export_format'),
})

export const permissionLog = sqliteTable('permission_log', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  input: text('input', { mode: 'json' }),
  decision: text('decision').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type SessionRecord = typeof sessions.$inferSelect
export type MessageRecord = typeof messages.$inferSelect
export type PartRecord = typeof parts.$inferSelect
