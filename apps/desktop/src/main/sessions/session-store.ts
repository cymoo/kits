import type {
  FileDiffView,
  MessageView,
  OutputView,
  PartPayload,
  PartView,
  PermissionMode,
  SessionDetail,
  SessionStatus,
  SessionSummary,
} from '@kits/core'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db'
import {
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
    const rows = this.db
      .select({ k: messages.kernelTurn })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
    const next = at ?? rows.reduce((n, r) => Math.max(n, r.k ?? 0), 0) + 1
    this.db.update(messages).set({ kernelTurn: next }).where(eq(messages.id, messageId)).run()
    return next
  }

  // 内核的第几条用户消息 → 本地第几轮
  kernelTurns(sessionId: string): Map<number, number> {
    const rows = this.db
      .select({ k: messages.kernelTurn, turn: messages.turn })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
    return new Map(rows.flatMap((r) => (r.k ? [[r.k, r.turn] as [number, number]] : [])))
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
    }
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
