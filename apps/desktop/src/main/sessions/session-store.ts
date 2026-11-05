import type {
  AttachmentView,
  FileDiffView,
  MessageView,
  OutputView,
  PartPayload,
  PartView,
  PermissionMode,
  PermissionRule,
  SessionDetail,
  SessionStatus,
  SessionSummary,
} from '@kits/core'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db'
import {
  attachments,
  diffs,
  type MessageRecord,
  messages,
  type OutputRecord,
  outputs,
  type PartRecord,
  parts,
  permissionLog,
  type SessionRecord,
  sessions,
} from '../db/schema'

// 会话的读写（phase1-implementation 5.4 节）。表里的行和界面用的视图在这里互转。

// 搜索结果里命中部分的标记（渲染进程按它高亮）：控制字符，正文里不会有
export const HIT_OPEN = '\u0001'
export const HIT_CLOSE = '\u0002'

export interface SearchHit {
  id: string
  // 标题，命中的部分夹在 HIT_OPEN / HIT_CLOSE 之间
  title: string
  // 正文里命中的那一段；只有标题命中时为 null
  snippet: string | null
}

// LIKE 的通配符要转义
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// 没走 FTS（查询太短）时自己标命中、截一段正文
function mark(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const t of terms) {
    const needle = t.toLowerCase()
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length))
      ranges.push([i, i + needle.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let at = 0
  for (const [from, to] of ranges) {
    if (from < at) continue
    out += `${text.slice(at, from)}${HIT_OPEN}${text.slice(from, to)}${HIT_CLOSE}`
    at = to
  }
  return out + text.slice(at)
}

function excerpt(text: string, terms: string[], radius = 24): string | null {
  const lower = text.toLowerCase()
  const hits = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0)
  if (hits.length === 0) return null
  const at = Math.min(...hits)
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + radius * 2)
  const piece = text.slice(from, to).replace(/\s+/g, ' ')
  return `${from > 0 ? '…' : ''}${mark(piece, terms)}${to < text.length ? '…' : ''}`
}

export function toSummary(r: SessionRecord): SessionSummary {
  return {
    id: r.id,
    title: r.title,
    agent: r.agent,
    kernel: r.kernel as SessionSummary['kernel'],
    workdir: r.workdir,
    model: r.model,
    permissionMode: r.permissionMode as PermissionMode,
    status: r.status as SessionStatus,
    turns: r.turns,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
    lastError: r.lastError,
    pinnedAt: r.pinnedAt,
  }
}

export function toMessage(r: MessageRecord): MessageView {
  return {
    id: r.id,
    sessionId: r.sessionId,
    role: r.role as MessageView['role'],
    turn: r.turn,
    text: r.text,
    createdAt: r.createdAt.getTime(),
    completedAt: r.completedAt?.getTime() ?? null,
    finishReason: r.finishReason,
    tokens: {
      input: r.tokensInput,
      output: r.tokensOutput,
      cacheRead: r.tokensCacheRead,
      cacheWrite: r.tokensCacheWrite,
    },
    cost: r.cost,
    contextTokens: r.contextTokens,
  }
}

export function toPart(r: PartRecord): PartView {
  return {
    id: r.id,
    messageId: r.messageId,
    sessionId: r.sessionId,
    seq: r.seq,
    type: r.type as PartView['type'],
    payload: r.payload as PartPayload,
    status: r.status,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  }
}

export function toOutput(r: OutputRecord): OutputView {
  const base = {
    id: r.id,
    sessionId: r.sessionId,
    turn: r.turn,
    editedAt: r.editedAt?.getTime() ?? null,
    exportedAt: r.exportedAt?.getTime() ?? null,
    exportFormat: (r.exportFormat as OutputView['exportFormat']) ?? null,
  }
  return r.kind === 'structured'
    ? { ...base, kind: 'structured', aiDraft: r.aiDraft, edited: r.edited ?? null }
    : {
        ...base,
        kind: 'text',
        aiDraft: typeof r.aiDraft === 'string' ? r.aiDraft : '',
        edited: typeof r.edited === 'string' ? r.edited : null,
      }
}

export class SessionStore {
  constructor(private readonly db: Database) {}

  insertSession(s: SessionSummary): void {
    this.db
      .insert(sessions)
      .values({
        ...s,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
      })
      .run()
  }

  updateSession(
    id: string,
    patch: Partial<Omit<SessionSummary, 'id'>> & { kernelSessionId?: string },
  ): SessionSummary | undefined {
    const { createdAt, updatedAt, ...rest } = patch
    this.db
      .update(sessions)
      .set({
        ...rest,
        ...(createdAt !== undefined ? { createdAt: new Date(createdAt) } : {}),
        ...(updatedAt !== undefined ? { updatedAt: new Date(updatedAt) } : {}),
      })
      .where(eq(sessions.id, id))
      .run()
    return this.session(id)
  }

  session(id: string): SessionSummary | undefined {
    const r = this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    return r ? toSummary(r) : undefined
  }

  kernelSessionId(id: string): string | null {
    return (
      this.db
        .select({ k: sessions.kernelSessionId })
        .from(sessions)
        .where(eq(sessions.id, id))
        .get()?.k ?? null
    )
  }

  list(): SessionSummary[] {
    return this.db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all().map(toSummary)
  }

  saveMessage(m: MessageView): void {
    const values = {
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      turn: m.turn,
      text: m.text,
      createdAt: new Date(m.createdAt),
      completedAt: m.completedAt === null ? null : new Date(m.completedAt),
      finishReason: m.finishReason,
      tokensInput: m.tokens.input,
      tokensOutput: m.tokens.output,
      tokensCacheRead: m.tokens.cacheRead,
      tokensCacheWrite: m.tokens.cacheWrite,
      cost: m.cost,
      contextTokens: m.contextTokens,
    }
    this.db
      .insert(messages)
      .values(values)
      .onConflictDoUpdate({ target: messages.id, set: values })
      .run()
  }

  savePart(p: PartView): void {
    const values = {
      id: p.id,
      messageId: p.messageId,
      sessionId: p.sessionId,
      seq: p.seq,
      type: p.type,
      payload: p.payload,
      status: p.status,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }
    this.db.insert(parts).values(values).onConflictDoUpdate({ target: parts.id, set: values }).run()
  }

  // 记下这条用户消息是内核会话里的第几条；at 不给就接着已记下的最大值往后编
  assignKernelTurn(sessionId: string, messageId: string, at?: number): number {
    const next = at ?? this.nextKernelTurn(sessionId)
    this.db.update(messages).set({ kernelTurn: next }).where(eq(messages.id, messageId)).run()
    return next
  }

  // 下一条用户消息在内核里排第几
  nextKernelTurn(sessionId: string): number {
    return Math.max(0, ...this.kernelTurns(sessionId).keys()) + 1
  }

  // 内核的第几条用户消息 → 本地第几轮
  kernelTurns(sessionId: string): Map<number, number> {
    const rows = this.db
      .select({ k: messages.kernelTurn, turn: messages.turn })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
    // 插话也是内核里的一条用户消息，算在它所在的那一轮
    const interjects = this.db
      .select({ payload: parts.payload, turn: messages.turn })
      .from(parts)
      .innerJoin(messages, eq(parts.messageId, messages.id))
      .where(and(eq(parts.sessionId, sessionId), eq(parts.type, 'interject')))
      .all()
    return new Map([
      ...rows.flatMap((r) => (r.k ? [[r.k, r.turn] as [number, number]] : [])),
      ...interjects.map(
        (r) => [(r.payload as { kernelTurn: number }).kernelTurn, r.turn] as [number, number],
      ),
    ])
  }

  diffs(sessionId: string): FileDiffView[] {
    return this.db
      .select()
      .from(diffs)
      .where(eq(diffs.sessionId, sessionId))
      .orderBy(asc(diffs.turn), asc(diffs.path))
      .all()
      .map((r) => ({
        turn: r.turn,
        path: r.path,
        status: r.status as FileDiffView['status'],
        additions: r.additions,
        deletions: r.deletions,
        patch: r.patch,
      }))
  }

  // 内核每次给的是整个会话的改动，整份替换
  replaceDiffs(sessionId: string, list: FileDiffView[]): void {
    this.db.delete(diffs).where(eq(diffs.sessionId, sessionId)).run()
    for (const d of list) {
      this.db
        .insert(diffs)
        .values({ id: `${sessionId}:${d.turn}:${d.path}`, sessionId, ...d })
        .onConflictDoUpdate({ target: diffs.id, set: { ...d } })
        .run()
    }
  }

  attachments(sessionId: string): AttachmentView[] {
    return this.db
      .select({
        id: attachments.id,
        messageId: attachments.messageId,
        name: attachments.name,
        mime: attachments.mime,
        size: attachments.size,
      })
      .from(attachments)
      .where(eq(attachments.sessionId, sessionId))
      .all()
  }

  saveAttachment(row: {
    id: string
    sessionId: string
    messageId: string
    name: string
    mime: string
    size: number
    path: string
    textPath: string
  }): void {
    this.db.insert(attachments).values(row).run()
  }

  outputs(sessionId: string): OutputView[] {
    return this.db
      .select()
      .from(outputs)
      .where(eq(outputs.sessionId, sessionId))
      .orderBy(asc(outputs.turn))
      .all()
      .map(toOutput)
  }

  output(id: string): OutputView | undefined {
    const r = this.db.select().from(outputs).where(eq(outputs.id, id)).get()
    return r ? toOutput(r) : undefined
  }

  // AI 交了新的原稿（这一轮的回复正文，或者 submit_output 又交了一次）：人工修改作废
  saveDraft(input: {
    sessionId: string
    turn: number
    kind: OutputView['kind']
    aiDraft: unknown
  }): OutputView {
    const values = {
      id: `${input.sessionId}:${input.turn}`,
      sessionId: input.sessionId,
      turn: input.turn,
      kind: input.kind,
      aiDraft: input.aiDraft,
      edited: null,
      editedAt: null,
    }
    this.db
      .insert(outputs)
      .values(values)
      .onConflictDoUpdate({ target: outputs.id, set: values })
      .run()
    return this.output(values.id) as OutputView
  }

  // 人工修改；null 表示还原为 AI 原稿
  saveEdited(id: string, edited: unknown | null, at: number): OutputView | undefined {
    this.db
      .update(outputs)
      .set({ edited, editedAt: edited === null ? null : new Date(at) })
      .where(eq(outputs.id, id))
      .run()
    return this.output(id)
  }

  markExported(id: string, format: 'markdown' | 'json', at: number): OutputView | undefined {
    this.db
      .update(outputs)
      .set({ exportedAt: new Date(at), exportFormat: format })
      .where(eq(outputs.id, id))
      .run()
    return this.output(id)
  }

  // 某个会话里的提问 part（回答不阻塞的提问时用）
  questionPart(sessionId: string, questionId: string): PartView | undefined {
    return this.db
      .select()
      .from(parts)
      .where(and(eq(parts.sessionId, sessionId), eq(parts.type, 'question')))
      .all()
      .map(toPart)
      .find((p) => p.payload.type === 'question' && p.payload.questionId === questionId)
  }

  // 这个会话里用户点过“本会话允许”的规则
  alwaysRules(sessionId: string): PermissionRule[] {
    return this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.sessionId, sessionId),
          eq(parts.type, 'permission'),
          eq(parts.status, 'always'),
        ),
      )
      .all()
      .map(toPart)
      .flatMap(({ payload }) =>
        payload.type === 'permission'
          ? payload.always.map((pattern) => ({
              tool: payload.tool,
              pattern,
              level: 'allow' as const,
            }))
          : [],
      )
  }

  logPermission(entry: {
    id: string
    sessionId: string
    tool: string
    input: unknown
    decision: string
    createdAt: number
  }): void {
    this.db
      .insert(permissionLog)
      .values({ ...entry, createdAt: new Date(entry.createdAt) })
      .run()
  }

  detail(id: string): SessionDetail | null {
    const session = this.session(id)
    if (!session) return null
    return {
      session,
      messages: this.db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, id))
        .orderBy(asc(messages.createdAt))
        .all()
        .map(toMessage),
      parts: this.db
        .select()
        .from(parts)
        .where(eq(parts.sessionId, id))
        .orderBy(asc(parts.createdAt), asc(parts.seq))
        .all()
        .map(toPart),
      attachments: this.attachments(id),
    }
  }

  // 搜索索引：标题 + 用户消息 + 回复正文，按时间连起来。用户发消息、一轮结束时调
  reindex(id: string): void {
    this.db.run(sql`DELETE FROM sessions_fts WHERE session_id = ${id}`)
    this.db.run(sql`
      INSERT INTO sessions_fts (session_id, title, content)
      SELECT s.id, s.title, coalesce((
        SELECT group_concat(t, char(10)) FROM (
          SELECT m.text AS t, m.created_at AS c FROM messages m
          WHERE m.session_id = s.id AND m.role = 'user' AND m.text <> ''
          UNION ALL
          SELECT json_extract(p.payload, '$.text'), p.created_at FROM parts p
          WHERE p.session_id = s.id AND p.type = 'text'
          ORDER BY c
        )
      ), '') FROM sessions s WHERE s.id = ${id}`)
  }

  // 按空格分成几个词，都要命中（标题或正文）。每个词都不少于 3 个字走 FTS（trigram），否则走 LIKE
  search(query: string, limit = 20): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    if (terms.every((t) => [...t].length >= 3)) {
      const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
      return this.db
        .all<{ id: string; title: string; snippet: string; inContent: number }>(sql`
          SELECT f.session_id AS id,
            highlight(sessions_fts, 1, ${HIT_OPEN}, ${HIT_CLOSE}) AS title,
            snippet(sessions_fts, 2, ${HIT_OPEN}, ${HIT_CLOSE}, '…', 16) AS snippet,
            instr(snippet(sessions_fts, 2, ${HIT_OPEN}, ${HIT_CLOSE}, '', 16), ${HIT_OPEN}) AS inContent
          FROM sessions_fts f JOIN sessions s ON s.id = f.session_id
          WHERE sessions_fts MATCH ${match}
          ORDER BY rank, s.updated_at DESC
          LIMIT ${limit}`)
        .map((r) => ({ id: r.id, title: r.title, snippet: r.inContent ? r.snippet : null }))
    }
    const where = terms.map(
      (t) =>
        sql`(f.title LIKE ${`%${likeEscape(t)}%`} ESCAPE '\\' OR f.content LIKE ${`%${likeEscape(t)}%`} ESCAPE '\\')`,
    )
    return this.db
      .all<{ id: string; title: string; content: string }>(sql`
        SELECT f.session_id AS id, f.title AS title, f.content AS content
        FROM sessions_fts f JOIN sessions s ON s.id = f.session_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY s.updated_at DESC
        LIMIT ${limit}`)
      .map((r) => ({ id: r.id, title: mark(r.title, terms), snippet: excerpt(r.content, terms) }))
  }

  // 删会话：消息、块、附件记录、改动、产出跟着级联删掉，搜索索引单独删
  remove(id: string): void {
    this.db.run(sql`DELETE FROM sessions_fts WHERE session_id = ${id}`)
    this.db.delete(sessions).where(eq(sessions.id, id)).run()
  }

  // 一起删：中途失败时一个也不删
  removeAll(ids: string[]): void {
    this.db.transaction((tx) => {
      for (const id of ids) {
        tx.run(sql`DELETE FROM sessions_fts WHERE session_id = ${id}`)
        tx.delete(sessions).where(eq(sessions.id, id)).run()
      }
    })
  }

  // 应用退出时还在跑的会话：下次打开时标成中断，不然一直显示“运行中”。
  // 没结束的助手消息一起收尾，留一个出错块；没回复的确认标成过期，对话流和会话状态一致
  markInterrupted(now: number): number {
    const message = '应用退出时这一轮还没做完'
    const at = new Date(now)
    let n = 0
    for (const s of this.list()) {
      if (s.status !== 'running' && s.status !== 'waiting') continue
      this.updateSession(s.id, { status: 'error', lastError: message, updatedAt: now })
      n += 1
    }
    const open = this.db
      .select()
      .from(messages)
      .where(and(eq(messages.role, 'assistant'), isNull(messages.completedAt)))
      .all()
    for (const m of open) {
      this.db
        .update(messages)
        .set({ completedAt: at, finishReason: 'error' })
        .where(eq(messages.id, m.id))
        .run()
      const own = this.db.select().from(parts).where(eq(parts.messageId, m.id)).all()
      for (const p of own.map(toPart)) {
        if (p.status !== 'pending') continue
        // 不阻塞的提问之后还能回答（回答作为下一条消息），保持 pending
        if (p.payload.type === 'question' && !p.payload.blocking) continue
        this.db
          .update(parts)
          .set({ status: 'expired', updatedAt: at })
          .where(eq(parts.id, p.id))
          .run()
      }
      this.savePart({
        id: `${m.id}:error`,
        messageId: m.id,
        sessionId: m.sessionId,
        seq: own.reduce((max, p) => Math.max(max, p.seq + 1), 0),
        type: 'error',
        payload: { type: 'error', message },
        status: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    return n
  }
}
