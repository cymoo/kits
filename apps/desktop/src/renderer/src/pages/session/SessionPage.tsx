import type { SessionSummary } from '@kits/core/ipc'
import { Check, Folder, Square } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router'
import { t } from '../../app/i18n'
import { basename } from '../../lib/composer-prefs'
import { kits } from '../../lib/kits'
import { useLiveSession } from '../../lib/sessions'
import { shortcuts, useShortcuts } from '../../lib/shortcuts'
import { formatDuration, useNow } from '../../lib/use-now'
import {
  ErrorBlock,
  StatusLine,
  TextBlock,
  TurnBlock,
  UserBlock,
} from '../../session/thread/Blocks'
import { deriveBlocks } from '../../session/thread/derive'
import { Composer } from '../../shell/Composer'
import { cx } from '../../ui/cx'

// 会话页（原型 session.html）：顶栏（标题、状态、目录、Agent · 内核 · 模型、停止）+ 对话流 + 输入框。
// 右侧的改动 / 产出 / 终端 / 上下文面板在 PR9。

function StatusPill({ session, startedAt }: { session: SessionSummary; startedAt: number }) {
  const live = session.status === 'running' || session.status === 'waiting'
  const now = useNow(1000, session.status === 'running')
  const tone = {
    running: 'bg-accent-bg text-accent-fg',
    waiting: 'bg-warn-bg text-warn',
    done: 'bg-ok-bg text-ok',
    error: 'bg-danger-bg text-danger',
    aborted: 'bg-active text-fg-muted',
  }[session.status]
  const text =
    session.status === 'running'
      ? t('pill.running', { n: session.turns, time: formatDuration(now - startedAt) })
      : t(`pill.${session.status}`, { n: session.turns })
  return (
    <span
      data-testid="session-status"
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-[9px] py-px font-medium text-[0.923rem]',
        tone,
      )}
    >
      {live ? (
        <span
          aria-hidden="true"
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            session.status === 'running'
              ? 'animate-[k-pulse_1.4s_ease-in-out_infinite] bg-accent'
              : 'bg-warn',
          )}
        />
      ) : null}
      {session.status === 'done' ? <Check size={11} strokeWidth={2.4} /> : null}
      {text}
    </span>
  )
}

export function SessionPage() {
  const { id } = useParams()
  const { detail, loading, activity } = useLiveSession(id)
  const session = detail?.session
  const running = session?.status === 'running' || session?.status === 'waiting'
  const now = useNow(1000, running)
  const blocks = useMemo(
    () => (detail ? deriveBlocks(detail, activity, now) : []),
    [detail, activity, now],
  )
  const lastTurnStart =
    detail?.messages.filter((m) => m.role === 'assistant').at(-1)?.createdAt ?? 0

  // 新内容来了滚到底；用户往上翻了就不打扰
  const scroller = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  // 换了会话就重新跟随到底；同一会话里往上翻了才不打扰
  // biome-ignore lint/correctness/useExhaustiveDependencies: id 变了才重置
  useEffect(() => {
    pinned.current = true
  }, [id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 块变了才需要滚动
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [blocks])

  useShortcuts({ stop: () => (id && running ? void kits.session.abort(id) : undefined) })

  if (!id || (!loading && !session)) {
    return <p className="m-10 text-fg-muted">{t('session.missing')}</p>
  }
  if (!session) return null

  const model = session.model.slice(session.model.indexOf('/') + 1)
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-line-soft border-b pr-4 pl-5">
        <h1 className="m-0 min-w-0 truncate font-semibold text-[1.077rem]">{session.title}</h1>
        <StatusPill session={session} startedAt={lastTurnStart} />
        <span className="flex-1" />
        <span
          className="inline-flex items-center gap-1.5 text-[0.923rem] text-fg-muted"
          title={session.workdir}
        >
          <Folder size={13} />
          <span className="font-mono">{basename(session.workdir)}</span>
        </span>
        <span className="font-mono text-[0.923rem] text-fg-muted">
          {[
            session.agent !== 'assistant' ? session.agent : null,
            session.kernel === 'opencode' ? 'OpenCode' : 'CodeAgent',
            model,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {running ? (
          <button
            type="button"
            onClick={() => void kits.session.abort(session.id)}
            // macOS 顶部有一条全宽的拖动窗口层，按钮要浮在它上面、不参与拖动
            className="relative z-20 inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-raised px-2.5 text-[0.923rem] text-fg [-webkit-app-region:no-drag] hover:bg-active"
          >
            <Square size={10} fill="currentColor" />
            {t('session.stop')}
            <span className="text-[0.846rem] text-fg-subtle">{shortcuts.stop.label}</span>
          </button>
        ) : null}
      </header>
      <section
        ref={scroller}
        aria-label={t('session.thread')}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pt-6"
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-[18px] pb-4">
          {blocks.map((b) => {
            switch (b.kind) {
              case 'user':
                return <UserBlock key={b.id} text={b.text} />
              case 'turn':
                return <TurnBlock key={b.id} block={b} />
              case 'text':
                return <TextBlock key={b.id} block={b} />
              case 'status':
                return <StatusLine key={b.id} block={b} />
              case 'error':
                return <ErrorBlock key={b.id} block={b} />
              default:
                return null
            }
          })}
        </div>
        <div className="sticky bottom-0 mx-auto w-full max-w-[760px] bg-gradient-to-b from-transparent to-raised to-[14px] pt-3 pb-4">
          <Composer
            // 每个会话一个输入框：草稿不会跟到别的会话里
            key={session.id}
            locked
            lockedAs={session}
            disabled={running}
            placeholder={running ? t('composer.followUpRunning') : t('composer.followUp')}
            onSubmit={({ text }) => kits.session.prompt({ id: session.id, text })}
          />
        </div>
      </section>
    </div>
  )
}
