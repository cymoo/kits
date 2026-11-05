import type { GeneralSettings, PartView, PushEvents, SessionSummary } from '@kits/core'

// 系统通知（phase1-implementation PR18）：命令等确认、Agent 提问、出错（“需要我处理时”），会话完成（“会话完成时”）。
// 窗口在前台时不发；点通知打开对应的会话。同一件事只发一次。
// 从会话服务的推送里看：part 推送里有待确认 / 提问，session.changed 里看状态从运行中变成什么。

export interface NotifyMessage {
  sessionId: string
  title: string
  body: string
}

export interface NotifierDeps {
  general(): GeneralSettings
  // 有 kits 的窗口在前台
  focused(): boolean
  session(id: string): SessionSummary | undefined
  show(message: NotifyMessage): void
  // 等人处理的会话数变了（macOS 程序坞角标）
  onWaitingCount?(n: number): void
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export class Notifier {
  private status = new Map<string, SessionSummary['status']>()
  private sent = new Set<string>()

  constructor(private readonly deps: NotifierDeps) {}

  observe<C extends keyof PushEvents>(channel: C, payload: PushEvents[C]): void {
    if (channel === 'session.part') this.onPart(payload as PartView)
    else if (channel === 'session.changed') this.onSession(payload as SessionSummary)
  }

  private notify(key: string, message: NotifyMessage): void {
    if (this.sent.has(key)) return
    this.sent.add(key)
    if (this.deps.focused()) return
    this.deps.show(message)
  }

  private onPart(p: PartView): void {
    if (p.status !== 'pending' || !this.deps.general().notifyOnWait) return
    const title = this.deps.session(p.sessionId)?.title ?? 'kits'
    if (p.payload.type === 'permission') {
      const subject = p.payload.patterns[0] ?? p.payload.tool
      this.notify(`part:${p.id}`, {
        sessionId: p.sessionId,
        title: `有命令等你确认 · ${clip(title, 40)}`,
        body: clip(subject),
      })
    } else if (p.payload.type === 'question') {
      this.notify(`part:${p.id}`, {
        sessionId: p.sessionId,
        title: `Agent 有个问题 · ${clip(title, 40)}`,
        body: clip(p.payload.question),
      })
    }
  }

  private onSession(s: SessionSummary): void {
    const before = this.status.get(s.id)
    this.status.set(s.id, s.status)
    this.deps.onWaitingCount?.([...this.status.values()].filter((x) => x === 'waiting').length)
    // 只看“这一轮刚结束”：从运行中 / 等处理变成出错、完成
    if (before !== 'running' && before !== 'waiting') return
    const g = this.deps.general()
    if (s.status === 'error' && g.notifyOnWait) {
      this.notify(`end:${s.id}:${s.updatedAt}`, {
        sessionId: s.id,
        title: `出错了 · ${clip(s.title, 40)}`,
        body: clip(s.lastError ?? '这一轮没做完'),
      })
    } else if (s.status === 'done' && g.notifyOnDone) {
      this.notify(`end:${s.id}:${s.updatedAt}`, {
        sessionId: s.id,
        title: `完成了 · ${clip(s.title, 40)}`,
        body: '这一轮做完了',
      })
    }
  }

  forget(sessionId: string): void {
    this.status.delete(sessionId)
  }
}
