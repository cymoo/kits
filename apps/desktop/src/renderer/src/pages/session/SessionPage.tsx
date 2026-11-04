import type { SessionSummary } from '@kits/core/ipc'
import {
  AlertCircle,
  ArrowDown,
  Check,
  Clock,
  Folder,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Square,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { t } from '../../app/i18n'
import { basename, usePrefs } from '../../lib/composer-prefs'
import { kits, useSettings } from '../../lib/kits'
import { useLiveSession, useSessionDiffs, useSessionOutputs } from '../../lib/sessions'
import { shortcuts, useShortcuts } from '../../lib/shortcuts'
import { useUi } from '../../lib/ui-store'
import { formatDuration, useNow } from '../../lib/use-now'
import { alwaysRules, deriveRounds, deriveUsage, formatTokens } from '../../session/panels/derive'
import { type PanelTab, type PickedFile, Workbench } from '../../session/panels/Workbench'
import {
  CompactionDivider,
  StatusLine,
  TextBlock,
  TurnBlock,
  UserBlock,
} from '../../session/thread/Blocks'
import { ErrorCard, PermissionCard, QuestionCard, RetryBar } from '../../session/thread/Cards'
import { deriveBlocks, deriveTodos } from '../../session/thread/derive'
import { useFollowBottom } from '../../session/thread/follow-bottom'
import { PlanCard } from '../../session/thread/Plan'
import { Composer } from '../../shell/Composer'
import { cx } from '../../ui/cx'
import { ResizeHandle } from '../../ui/ResizeHandle'
import { Tooltip } from '../../ui/Tooltip'

// 会话页（原型 session.html）：顶栏（标题、状态、目录、Agent · 内核 · 模型、停止）+ 对话流 + 输入框。
// 右侧的改动 / 产出 / 上下文面板在 PR9。

function StatusPill({
  session,
  startedAt,
  answering,
}: {
  session: SessionSummary
  startedAt: number
  // 在等的是提问的回答，不是确认
  answering: boolean
}) {
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
      : session.status === 'waiting' && answering
        ? t('pill.answer')
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

// 运行中发的消息：这一轮结束后合成一条发出去
function Queued({ items }: { items: string[] }) {
  return (
    <div
      data-testid="queued"
      className="mb-2 flex flex-col gap-1 rounded-[10px] border border-line-soft border-dashed bg-bg/60 px-3 py-2"
    >
      <span className="flex items-center gap-1.5 text-[0.846rem] text-fg-subtle">
        <Clock size={11} />
        {t('queue.label')}
      </span>
      {items.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 排队的消息可能重复，只按位置区分
        <span key={i} className="line-clamp-2 whitespace-pre-wrap text-[0.962rem] text-fg-muted">
          {text}
        </span>
      ))}
    </div>
  )
}

// 顶栏右端：收起时“显示面板”，窄栏时“放大”，放大时“缩回”；面板自己的“收起”在页签栏右边
function PanelButton() {
  const panel = useUi((u) => u.panel)
  const setPanel = useUi((u) => u.setPanel)
  const [label, Icon, next] =
    panel === 'hidden'
      ? [t('panel.show'), PanelRightOpen, 'side' as const]
      : panel === 'side'
        ? [t('panel.wide'), Maximize2, 'wide' as const]
        : [t('panel.narrow'), Minimize2, 'side' as const]
  return (
    <span className="relative z-20 flex items-center [-webkit-app-region:no-drag]">
      {panel !== 'hidden' ? (
        <Tooltip content={t('panel.hide')} side="bottom">
          <button
            type="button"
            aria-label={t('panel.hide')}
            onClick={() => setPanel('hidden')}
            className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[8px] text-fg-muted hover:bg-active hover:text-fg"
          >
            <PanelRightClose size={15} strokeWidth={1.6} />
          </button>
        </Tooltip>
      ) : null}
      <Tooltip
        content={panel === 'hidden' ? label : `${label} ${shortcuts.widePanel.label}`}
        side="bottom"
      >
        <button
          type="button"
          aria-label={label}
          onClick={() => setPanel(next)}
          className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[8px] text-fg-muted hover:bg-active hover:text-fg"
        >
          <Icon size={14} strokeWidth={1.6} />
        </button>
      </Tooltip>
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

  const thread = useFollowBottom(id)

  const diffs = useSessionDiffs(id)
  const outputs = useSessionOutputs(id)
  const settings = useSettings()
  const widths = useUi((u) => u.widths)
  const panel = useUi((u) => u.panel)
  const setPanel = useUi((u) => u.setPanel)
  const [tab, setTab] = useState<PanelTab>('changes')
  const [picked, setPicked] = useState<PickedFile>()
  const rounds = useMemo(
    () => (detail ? deriveRounds(detail, diffs.data ?? []) : []),
    [detail, diffs.data],
  )
  const rules = useMemo(() => (detail ? alwaysRules(detail) : []), [detail])
  const usage = useMemo(
    () =>
      detail ? deriveUsage(detail) : { context: 0, input: 0, output: 0, cacheRead: 0, cost: 0 },
    [detail],
  )
  const contextWindow = useMemo(() => {
    const ref = session?.model ?? ''
    const i = ref.indexOf('/')
    const gateway = settings.data?.gateways.find((g) => g.id === ref.slice(0, i))
    return gateway?.models.find((m) => m.id === ref.slice(i + 1))?.contextWindow ?? 0
  }, [session?.model, settings.data])
  const lastAnswer = blocks.findLast((b) => b.kind === 'text')?.id
  const todos = useMemo(() => (detail ? deriveTodos(detail) : []), [detail])

  useShortcuts({
    stop: () => (id && running ? void kits.session.abort(id) : undefined),
    widePanel: () => setPanel(panel === 'wide' ? 'side' : 'wide'),
  })

  if (!id || (!loading && !session)) {
    return <p className="m-10 text-fg-muted">{t('session.missing')}</p>
  }
  if (!session) return null

  const firstPermission = blocks.find((b) => b.kind === 'permission')?.id
  const answering =
    !firstPermission &&
    blocks.some((b) => b.kind === 'question' && b.blocking && b.state === 'pending')

  const model = session.model.slice(session.model.indexOf('/') + 1)
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-line-soft border-b pr-4 pl-5">
        <h1 className="m-0 min-w-0 truncate font-semibold text-[1.077rem]">{session.title}</h1>
        <StatusPill session={session} startedAt={lastTurnStart} answering={answering} />
        <span className="flex-1" />
        <span
          className="inline-flex min-w-0 items-center gap-1.5 text-[0.923rem] text-fg-muted"
          title={session.workdir}
        >
          <Folder size={13} className="shrink-0" />
          <span className="truncate font-mono">{basename(session.workdir)}</span>
        </span>
        <span className="min-w-0 truncate font-mono text-[0.923rem] text-fg-muted">
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
            className="relative z-20 inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line bg-raised px-2.5 text-[0.923rem] text-fg [-webkit-app-region:no-drag] hover:bg-active"
          >
            <Square size={10} fill="currentColor" />
            {t('session.stop')}
            <span className="text-[0.846rem] text-fg-subtle">{shortcuts.stop.label}</span>
          </button>
        ) : null}
        <PanelButton />
      </header>
      <div className="flex min-h-0 flex-1">
        <section
          ref={thread.ref}
          aria-label={t('session.thread')}
          onScroll={thread.onScroll}
          className={cx(
            'flex min-h-0 min-w-0 flex-col overflow-y-auto',
            panel === 'wide'
              ? // 窗口窄时给右边的面板留够地方
                'max-w-[calc(100%-360px)] shrink-0 border-line-soft border-r bg-panel px-5 pt-5'
              : 'flex-1 px-7 pt-6',
          )}
          style={panel === 'wide' ? { width: widths.chat } : undefined}
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-[18px] pb-4">
            {blocks.map((b) => {
              switch (b.kind) {
                case 'user':
                  return <UserBlock key={b.id} text={b.text} attachments={b.attachments} />
                case 'turn':
                  return (
                    <TurnBlock
                      key={b.id}
                      block={b}
                      onOpenFile={(turn, path) => {
                        setPicked({ turn, path })
                        setTab('changes')
                        if (panel === 'hidden') setPanel('side')
                      }}
                    />
                  )
                case 'text':
                  return <TextBlock key={b.id} block={b} quiet={running || b.id !== lastAnswer} />
                case 'status':
                  return <StatusLine key={b.id} block={b} />
                case 'permission':
                  return (
                    <PermissionCard
                      key={b.id}
                      block={b}
                      sessionId={session.id}
                      workdir={session.workdir}
                      active={b.id === firstPermission}
                    />
                  )
                case 'question':
                  return <QuestionCard key={b.id} block={b} sessionId={session.id} />
                case 'retry':
                  return <RetryBar key={b.id} block={b} sessionId={session.id} />
                case 'compaction':
                  return <CompactionDivider key={b.id} block={b} />
                case 'error':
                  return (
                    <ErrorCard
                      key={b.id}
                      block={b}
                      session={session}
                      canContinue={b.last && !running}
                    />
                  )
                default:
                  return null
              }
            })}
          </div>
          <div
            className={cx(
              'sticky bottom-0 mx-auto w-full max-w-[760px] bg-gradient-to-b from-transparent to-[14px] pt-3 pb-4',
              panel === 'wide' ? 'to-panel' : 'to-raised',
            )}
          >
            {thread.atBottom ? null : (
              <Tooltip content={t('session.toBottom')} side="top">
                <button
                  type="button"
                  aria-label={t('session.toBottom')}
                  onClick={thread.jump}
                  className="absolute bottom-full left-1/2 flex h-8 w-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-raised text-fg-muted shadow-pop hover:bg-active hover:text-fg"
                >
                  <ArrowDown size={15} />
                </button>
              </Tooltip>
            )}
            {session.queued?.length ? <Queued items={session.queued} /> : null}
            {todos.length ? <PlanCard items={todos} /> : null}
            <ContextBanner
              session={session}
              used={usage.context}
              window={contextWindow}
              hidden={running || blocks.at(-1)?.kind === 'compaction'}
            />
            <Composer
              // 每个会话一个输入框：草稿不会跟到别的会话里
              key={session.id}
              locked
              lockedAs={session}
              placeholder={running ? t('composer.followUpRunning') : t('composer.followUp')}
              onSubmit={({ text, attachments }) =>
                kits.session.prompt({ id: session.id, text, attachments })
              }
            />
          </div>
        </section>
        {panel === 'hidden' ? null : (
          <ResizeHandle
            id={panel === 'wide' ? 'chat' : 'panel'}
            side={panel === 'wide' ? 'left' : 'right'}
            label={t(panel === 'wide' ? 'resize.chat' : 'resize.panel')}
          />
        )}
        {panel === 'hidden' ? null : (
          <aside
            aria-label={t('panel.label')}
            className={cx(
              'flex min-h-0 min-w-0 flex-col bg-panel',
              panel === 'wide'
                ? 'flex-1'
                : // 窗口窄时给对话留够地方
                  'max-w-[calc(100%-320px)] shrink-0 border-line-soft border-l',
            )}
            style={panel === 'wide' ? undefined : { width: widths.panel }}
          >
            <Workbench
              detail={detail}
              rounds={rounds}
              picked={picked}
              onPick={setPicked}
              rules={rules}
              outputs={outputs.data ?? []}
              usage={usage}
              contextWindow={contextWindow}
              wide={panel === 'wide'}
              tab={tab}
              onTab={setTab}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

// 上下文接近上限（八成以上）时输入框上方的提示：现在压缩，或带着结论新开一个会话
function ContextBanner({
  session,
  used,
  window,
  hidden,
}: {
  session: SessionSummary
  used: number
  window: number
  hidden: boolean
}) {
  const navigate = useNavigate()
  const fillHome = useUi((s) => s.fillHome)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  if (hidden || !window || used / window < 0.8) return null
  const compact = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await kits.session.compact(session.id)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      role="status"
      data-testid="context-banner"
      className="mb-2 flex items-center gap-2.5 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[0.962rem]"
    >
      <AlertCircle size={14} className="shrink-0 text-warn-icon" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">
          {t('context.near', { used: formatTokens(used), window: formatTokens(window) })}
        </span>
        <span className="text-fg-muted">
          {' '}
          {error ? <span className="text-danger">{error}</span> : t('context.nearHint')}
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          // 新会话用同一个目录和 Agent，输入框里先放一句“接着上一个会话做”
          usePrefs.getState().set({ workdir: session.workdir, agent: session.agent })
          fillHome(t('context.carryOver', { title: session.title }))
          navigate('/')
        }}
        className="shrink-0 cursor-pointer text-[0.923rem] text-accent hover:text-accent-fg"
      >
        {t('context.newSession')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void compact()}
        className="h-7 shrink-0 cursor-pointer rounded-[8px] bg-primary px-2.5 font-medium text-[0.923rem] text-primary-fg hover:opacity-90 disabled:opacity-50"
      >
        {t('context.compactNow')}
      </button>
    </div>
  )
}
