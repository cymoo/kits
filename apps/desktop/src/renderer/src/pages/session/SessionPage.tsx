import { type QueuedDraft, type SessionSummary, workdirKey } from '@kits/core/ipc'
import {
  AlertCircle,
  ArrowDown,
  Check,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { t } from '../../app/i18n'
import { usePrefs } from '../../lib/composer-prefs'
import { errorText } from '../../lib/errors'
import { kits, useSettings } from '../../lib/kits'
import { useLiveSession, useSessionDiffs, useSessionOutputs } from '../../lib/sessions'
import { isMac, shortcuts, useShortcuts } from '../../lib/shortcuts'
import { useUi } from '../../lib/ui-store'
import { formatDuration, useNow } from '../../lib/use-now'
import { dirName } from '../../lib/workspaces'
import { ContextDialog } from '../../session/panels/ContextPanel'
import { alwaysRules, deriveRounds, deriveUsage, formatTokens } from '../../session/panels/derive'
import { type PanelTab, type PickedFile, Workbench } from '../../session/panels/Workbench'
import {
  CompactionDivider,
  NoticeLine,
  StatusLine,
  TextBlock,
  TurnBlock,
  UserBlock,
} from '../../session/thread/Blocks'
import { ErrorCard, PermissionCard, QuestionCard, RetryBar } from '../../session/thread/Cards'
import { deriveBlocks, deriveTodos } from '../../session/thread/derive'
import { useFollowBottom } from '../../session/thread/follow-bottom'
import { holdDraft, takeDraft } from '../../session/thread/held-drafts'
import { OutputCard } from '../../session/thread/OutputCard'
import { placeOutputs } from '../../session/thread/outputs'
import { PlanCard } from '../../session/thread/Plan'
import { QueuePanel } from '../../session/thread/QueuePanel'
import { Composer, type ComposerHandle } from '../../shell/Composer'
import { InlineRename } from '../../shell/InlineRename'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { ResizeHandle } from '../../ui/ResizeHandle'
import { Tooltip } from '../../ui/Tooltip'
import { SessionMenu } from './SessionMenu'

// 会话页（原型 session.html）：顶栏（工作区 / 标题、状态、… 菜单、面板按钮）+ 对话流 + 输入框 + 右侧面板。

function StatusPill({
  session,
  startedAt,
  spent,
  answering,
}: {
  session: SessionSummary
  startedAt: number
  // 刚结束的这一轮用了多久；还没有结束过时没有
  spent: number | undefined
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
      ? t('pill.running', { time: formatDuration(now - startedAt) })
      : session.status === 'waiting' && answering
        ? t('pill.answer')
        : session.status === 'done' && spent !== undefined
          ? t('pill.doneIn', { time: formatDuration(spent) })
          : t(`pill.${session.status}`)
  return (
    <span
      data-testid="session-status"
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-[12px] px-[9px] py-px font-medium text-[0.929rem]',
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
  // 压缩也记成一条助手消息，它的耗时不算这一轮的
  const lastTurn = detail?.messages.findLast(
    (m) => m.role === 'assistant' && m.finishReason !== 'compaction',
  )
  const spent = lastTurn?.completedAt ? lastTurn.completedAt - lastTurn.createdAt : undefined

  const thread = useFollowBottom(id)

  const diffs = useSessionDiffs(id)
  const outputs = useSessionOutputs(id)
  const settings = useSettings()
  const widths = useUi((u) => u.widths)
  const panel = useUi((u) => u.panel)
  const setPanel = useUi((u) => u.setPanel)
  // 文件用得最多（很多工作目录不是 Git 仓库，没有改动可看），默认先开文件；点改文件的步骤才跳到改动
  const [tab, setTab] = useState<PanelTab>('files')
  const [picked, setPicked] = useState<PickedFile>()
  const [outputOpen, setOutputOpen] = useState(false)
  const [pickedOutput, setPickedOutput] = useState<string>()
  const [contextOpen, setContextOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const renameInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<{ path: string } | { error: string }>()
  // 这些都跟着当前会话，换会话时收起
  // biome-ignore lint/correctness/useExhaustiveDependencies: id 变了才收
  useEffect(() => {
    setTab('files')
    setOutputOpen(false)
    setPickedOutput(undefined)
    setRenaming(false)
    setNotice(undefined)
  }, [id])
  const openOutput = (outputId?: string) => {
    setPickedOutput(outputId)
    setOutputOpen(true)
    setTab('output')
    if (panel === 'hidden') setPanel('side')
  }
  // 传给对话里各块的回调保持同一个函数，块的 memo 才有用；调用时读最新的面板状态和产出
  const latest = useRef({ panel, setPanel, openOutput, outputs: outputs.data })
  latest.current = { panel, setPanel, openOutput, outputs: outputs.data }
  const openTurnFile = useCallback((turn: number, path: string) => {
    setPicked({ turn, path })
    setTab('changes')
    if (latest.current.panel === 'hidden') latest.current.setPanel('side')
  }, [])
  const openTurnOutput = useCallback(() => {
    if (latest.current.outputs?.length) latest.current.openOutput()
  }, [])
  const exportOutput = async (outputId: string) => {
    try {
      const { path } = await kits.output.export({ id: outputId, format: 'json' })
      setNotice({ path })
    } catch (e) {
      setNotice({ error: t('session.exportFailed', { error: errorText(e) }) })
    }
  }
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
  const threadBlocks = useMemo(
    () => placeOutputs(blocks, outputs.data ?? []),
    [blocks, outputs.data],
  )
  const todos = useMemo(() => (detail ? deriveTodos(detail) : []), [detail])

  const composer = useRef<ComposerHandle>(null)
  const shownId = session?.id
  const shown = useRef(shownId)
  shown.current = shownId
  // 等退回的草稿时可能切到了别的会话：放回原来的会话，切回去时再填
  const restore = (sessionId: string, draft: QueuedDraft) => {
    if (shown.current === sessionId && composer.current) composer.current.restore(draft)
    else holdDraft(sessionId, draft)
  }
  useEffect(() => {
    const draft = shownId ? takeDraft(shownId) : undefined
    if (draft) composer.current?.restore(draft)
  }, [shownId])
  const stop = async (sessionId: string) => {
    const draft = await kits.session.abort(sessionId)
    if (draft) restore(sessionId, draft)
  }

  useShortcuts({
    stop: () => (id && running ? void stop(id) : undefined),
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

  // 对话里的一块；外面套的 k-thread-item 让屏幕外的块跳过布局和绘制（index.css）
  const renderBlock = (b: (typeof threadBlocks)[number]) => {
    switch (b.kind) {
      case 'output':
        return (
          <OutputCard
            key={b.id}
            output={b.output}
            agent={session.agent}
            onOpen={() => openOutput(b.output.id)}
            onExport={() => void exportOutput(b.output.id)}
          />
        )
      case 'user':
        return (
          <UserBlock
            key={b.id}
            text={b.text}
            attachments={b.attachments}
            {...(b.pending ? { pending: true } : {})}
          />
        )
      case 'turn':
        return (
          <TurnBlock key={b.id} block={b} onOpenFile={openTurnFile} onOpenOutput={openTurnOutput} />
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
      case 'notice':
        return <NoticeLine key={b.id} block={b} />
      case 'error':
        return <ErrorCard key={b.id} block={b} session={session} canContinue={b.last && !running} />
      default:
        return null
    }
  }

  const key = workdirKey(session.workdir)
  const workspace =
    settings.data?.workdirs.find((w) => workdirKey(w.path) === key)?.label ??
    dirName(session.workdir)
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      <header className="flex h-12 shrink-0 items-center gap-2 border-line-soft border-b pr-3 pl-5">
        <span
          className="min-w-0 shrink truncate text-[0.929rem] text-fg-muted"
          title={session.workdir}
        >
          {session.agent !== 'assistant' ? `${workspace} · ${session.agent}` : workspace}
        </span>
        <span aria-hidden="true" className="text-line-strong">
          /
        </span>
        {renaming ? (
          <span className="min-w-[200px] max-w-[420px] flex-1">
            <InlineRename
              value={session.title}
              label={t('nav.renameLabel')}
              maxLength={120}
              input={renameInput}
              save={(title) => kits.session.rename({ id: session.id, title })}
              onDone={() => setRenaming(false)}
            />
          </span>
        ) : (
          <h1 className="m-0 min-w-0 truncate font-medium text-[1rem]">{session.title}</h1>
        )}
        <StatusPill
          session={session}
          startedAt={lastTurnStart}
          spent={spent}
          answering={answering}
        />
        <span className="flex-1" />
        <SessionMenu
          session={session}
          onRename={() => setRenaming(true)}
          onExported={(path) => setNotice({ path })}
          onFailed={(error) => setNotice({ error })}
        />
        <PanelButton />
      </header>
      {notice ? (
        <div
          role={'error' in notice ? 'alert' : 'status'}
          className={cx(
            'flex shrink-0 items-center gap-2 border-line-soft border-b px-5 py-1.5 text-[0.929rem]',
            'error' in notice ? 'bg-danger-bg/60 text-danger' : 'bg-ok-bg/50 text-ok',
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {'error' in notice
              ? notice.error
              : t('session.exported', { path: notice.path.split(/[\\/]/).pop() ?? '' })}
          </span>
          {'path' in notice ? (
            <Button variant="link" onClick={() => void kits.app.revealPath(notice.path)}>
              {t(isMac ? 'nav.revealMac' : 'nav.reveal')}
            </Button>
          ) : null}
          <button
            type="button"
            aria-label={t('session.dismiss')}
            onClick={() => setNotice(undefined)}
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[4px] hover:bg-active"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <section
          ref={thread.ref}
          aria-label={t('session.thread')}
          onScroll={thread.onScroll}
          className={cx(
            // 滚动条的位置一直留着：内容刚超出一屏时宽度不变，文字不用重排
            'flex min-h-0 min-w-0 flex-col overflow-y-auto [scrollbar-gutter:stable]',
            panel === 'wide'
              ? // 窗口窄时给右边的面板留够地方
                'max-w-[calc(100%-360px)] shrink-0 border-line-soft border-r bg-panel px-5 pt-5'
              : 'flex-1 px-7 pt-6',
          )}
          style={panel === 'wide' ? { width: widths.chat } : undefined}
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-[18px] pb-4">
            {threadBlocks.map((b) => (
              <div key={b.id} className="k-thread-item">
                {renderBlock(b)}
              </div>
            ))}
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
            {todos.length ? <PlanCard items={todos} /> : null}
            <ContextBanner
              session={session}
              used={usage.context}
              window={contextWindow}
              hidden={running || blocks.at(-1)?.kind === 'compaction'}
            />
            {session.queued?.length ? (
              <QueuePanel
                sessionId={session.id}
                items={session.queued}
                canInterject={running && !!session.canInterject}
                onEdit={(draft) => restore(session.id, draft)}
                onInterject={thread.jump}
              />
            ) : null}
            <Composer
              // 每个会话一个输入框：草稿不会跟到别的会话里
              key={session.id}
              ref={composer}
              locked
              lockedAs={session}
              onPermission={(mode) => kits.session.setPermissionMode({ id: session.id, mode })}
              onModel={(next) => kits.session.setModel({ id: session.id, model: next })}
              context={{
                used: usage.context,
                window: contextWindow,
                onOpen: () => setContextOpen(true),
              }}
              placeholder={t('composer.followUp')}
              onSubmit={({ text, attachments }) =>
                kits.session.prompt({ id: session.id, text, attachments })
              }
              {...(running ? { onStop: () => void stop(session.id) } : {})}
              {...(running && session.canInterject
                ? {
                    onInterject: async ({ text, attachments }) => {
                      await kits.session.interject({
                        id: session.id,
                        ...(text ? { text, attachments } : {}),
                      })
                      thread.jump()
                    },
                  }
                : {})}
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
              // 文件面板看到哪跟着会话走
              key={session.id}
              detail={detail}
              rounds={rounds}
              picked={picked}
              onPick={setPicked}
              outputs={outputs.data ?? []}
              outputOpen={outputOpen}
              onCloseOutput={() => {
                setOutputOpen(false)
                setTab('files')
              }}
              pickedOutput={pickedOutput}
              onPickOutput={setPickedOutput}
              onExported={(path) => setNotice({ path })}
              onQuote={(path) => composer.current?.restore({ text: `@${path} `, attachments: [] })}
              wide={panel === 'wide'}
              tab={tab}
              onTab={setTab}
            />
          </aside>
        )}
      </div>
      <ContextDialog
        open={contextOpen}
        onOpenChange={setContextOpen}
        detail={detail}
        rules={rules}
        usage={usage}
        contextWindow={contextWindow}
      />
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
      className="mb-2 flex items-center gap-2.5 rounded-[12px] border border-warn-line bg-warn-soft px-3 py-2 text-[0.929rem]"
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
        className="shrink-0 cursor-pointer text-[0.929rem] text-accent hover:text-accent-fg"
      >
        {t('context.newSession')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void compact()}
        className="h-7 shrink-0 cursor-pointer rounded-[8px] bg-primary px-2.5 font-medium text-[0.929rem] text-primary-fg hover:opacity-90 disabled:opacity-50"
      >
        {t('context.compactNow')}
      </button>
    </div>
  )
}
