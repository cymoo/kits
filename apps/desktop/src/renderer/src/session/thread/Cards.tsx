import { AlertCircle, Check, ChevronDown, CircleHelp, SquareTerminal } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { kits, useHomeLabel } from '../../lib/kits'
import { isMac, modLabel } from '../../lib/shortcuts'
import { useNow } from '../../lib/use-now'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Kbd } from '../../ui/Kbd'
import { Spinner } from './Blocks'
import type { Block } from './derive'

// 对话里要你动手的卡片（原型 session.html）：命令确认、Agent 提问、重试条、出错卡片。

type Of<K extends Block['kind']> = Extract<Block, { kind: K }>

// 按钮点下去到主进程回来之前不能再点；出错了在卡片上说
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(e),
      )
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function CardIcon({ tone, children }: { tone: 'warn' | 'accent' | 'danger'; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]',
        tone === 'warn' && 'bg-warn-icon text-warn-strong',
        tone === 'accent' && 'bg-accent-icon text-accent-fg',
        tone === 'danger' && 'bg-danger-icon text-danger-strong',
      )}
    >
      {children}
    </span>
  )
}

function ActionError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="m-0 text-[0.923rem] text-danger">
      {message}
    </p>
  ) : null
}

// 焦点在别的输入框里（比如底部输入框）时，卡片的快捷键不抢
function typingElsewhere(e: globalThis.KeyboardEvent, card: HTMLElement | null): boolean {
  const el = e.target as HTMLElement | null
  if (!el || card?.contains(el)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function permissionHead(tool: string): string {
  if (tool === 'bash') return t('perm.head.bash')
  if (tool === 'edit' || tool === 'write' || tool === 'apply_patch') return t('perm.head.edit')
  if (tool === 'webfetch') return t('perm.head.webfetch')
  return t('perm.head.other', { tool })
}

export function PermissionCard({
  block,
  sessionId,
  workdir,
  active,
}: {
  block: Of<'permission'>
  sessionId: string
  workdir: string
  // 同时有几张待确认的卡片时，只有第一张响应快捷键
  active: boolean
}) {
  const homeLabel = useHomeLabel()
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const { busy, error, run } = useAction()
  const card = useRef<HTMLElement>(null)
  const reply = (r: 'once' | 'always' | 'reject', message?: string) =>
    run(() =>
      kits.session.respondPermission({
        id: sessionId,
        requestId: block.requestId,
        reply: r,
        ...(message?.trim() ? { message: message.trim() } : {}),
      }),
    )
  const latest = useRef({ reply, denying })
  latest.current = { reply, denying }

  useEffect(() => {
    if (!active) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (typingElsewhere(e, card.current)) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (e.key === 'Enter' && mod && !latest.current.denying) {
        e.preventDefault()
        void latest.current.reply('once')
      } else if (e.key === 'Escape' && !latest.current.denying) {
        e.preventDefault()
        setDenying(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const onReasonKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void reply('reject', reason)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDenying(false)
    }
  }
  const always = block.always[0]

  return (
    <section
      ref={card}
      aria-label={permissionHead(block.tool)}
      data-testid="permission-card"
      className="flex flex-col gap-2.5 rounded-[12px] border border-warn-line bg-warn-soft px-4 py-3.5 shadow-[0_0_0_4px_rgb(233_185_73/0.12)]"
    >
      <div className="flex items-center gap-2">
        <CardIcon tone="warn">
          <SquareTerminal size={13} strokeWidth={1.8} />
        </CardIcon>
        <span className="font-semibold">{permissionHead(block.tool)}</span>
        <span className="flex-1" />
        <span className="text-[0.923rem] text-warn">{t('perm.waiting')}</span>
      </div>
      {block.subject ? (
        <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-[9px] bg-code-bg px-3.5 py-2.5 font-mono text-[1rem] text-code-fg leading-[1.6]">
          {block.tool === 'bash' ? <span className="text-fg-label">$ </span> : null}
          {block.subject}
        </pre>
      ) : null}
      <div className="text-[0.923rem] text-fg-muted">
        {t('perm.workdir')}{' '}
        <span className="font-mono" title={workdir}>
          {homeLabel(workdir)}
        </span>
      </div>
      {denying ? (
        <div className="flex flex-col gap-2 pt-0.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.923rem] text-fg-muted">{t('perm.reasonLabel')}</span>
            <input
              // biome-ignore lint/a11y/noAutofocus: 点了拒绝就是要填原因
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={onReasonKey}
              placeholder={t('perm.reasonPlaceholder')}
              className="h-[34px] rounded-[8px] border border-line bg-raised px-3 text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button className="h-8" onClick={() => setDenying(false)}>
              {t('perm.back')}
            </Button>
            <Button
              variant="primary"
              className="h-8"
              disabled={busy}
              onClick={() => void reply('reject', reason)}
            >
              {t('perm.denyAndGo')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button className="h-[30px]" disabled={busy} onClick={() => setDenying(true)}>
            {t('perm.deny')}
            {active ? <Kbd>Esc</Kbd> : null}
          </Button>
          <span className="flex-1" />
          {always ? (
            <Button
              className="h-[30px] max-w-[320px]"
              disabled={busy}
              onClick={() => void reply('always')}
              title={block.always.join('\n')}
            >
              {t('perm.always')}
              <span className="truncate font-mono text-[0.923rem]">{always}</span>
            </Button>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void reply('once')}>
            {t('perm.once')}
            {active ? <Kbd className="text-primary-fg/60">{`${modLabel}↵`}</Kbd> : null}
          </Button>
        </div>
      )}
      <ActionError message={error} />
    </section>
  )
}

export function QuestionCard({ block, sessionId }: { block: Of<'question'>; sessionId: string }) {
  const [other, setOther] = useState('')
  const { busy, error, run } = useAction()
  const answer = (text: string) =>
    run(() =>
      kits.session.answerQuestion({ id: sessionId, questionId: block.questionId, answer: text }),
    )
  const waiting = block.blocking && block.state === 'pending'
  return (
    <section
      aria-label={t('question.head')}
      data-testid="question-card"
      className={cx(
        'flex flex-col gap-3 rounded-[12px] border px-4 py-3.5',
        block.state === 'pending'
          ? 'border-accent-line bg-accent-soft'
          : 'border-line-soft bg-raised',
      )}
    >
      <div className="flex items-center gap-2">
        <CardIcon tone="accent">
          <CircleHelp size={13} strokeWidth={1.7} />
        </CardIcon>
        <span className="font-semibold">{t('question.head')}</span>
        <span className="flex-1" />
        {block.state === 'pending' ? (
          <span className={cx('text-[0.923rem]', waiting ? 'text-accent-fg' : 'text-fg-muted')}>
            {waiting ? t('question.blocking') : t('question.nonblocking')}
          </span>
        ) : null}
      </div>
      <div className="font-medium text-[1.115rem] leading-[1.5]">{block.question}</div>
      {block.state === 'pending' ? (
        <div className="flex flex-col gap-2">
          {block.options.map((o) => (
            <button
              key={o}
              type="button"
              disabled={busy}
              onClick={() => void answer(o)}
              className="group flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-bg/40 disabled:cursor-default disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-line-strong transition-colors group-hover:border-accent"
              />
              <span className="font-medium">{o}</span>
              {o === block.assumption ? (
                <span className="ml-auto text-[0.923rem] text-fg-subtle">Agent 的假设</span>
              ) : null}
            </button>
          ))}
          <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-line bg-raised px-3 focus-within:border-accent">
            <span className="sr-only">{t('question.otherLabel')}</span>
            <input
              value={other}
              disabled={busy}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && other.trim()) {
                  e.preventDefault()
                  void answer(other)
                }
              }}
              placeholder={t('question.other')}
              className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
            />
            <Kbd>↵</Kbd>
          </label>
          {!block.blocking && block.assumption ? (
            <p className="m-0 text-[0.923rem] text-fg-muted">
              {t('question.assumption', { assumption: block.assumption })}
            </p>
          ) : null}
        </div>
      ) : block.state === 'answered' ? (
        <div className="flex items-center gap-2.5">
          <Check size={14} strokeWidth={2} className="text-ok" />
          <span>
            {t('question.answered')}
            <b className="font-semibold">{block.answer}</b>
          </span>
        </div>
      ) : (
        <div className="text-[0.923rem] text-fg-muted">{t('question.expired')}</div>
      )}
      <ActionError message={error} />
    </section>
  )
}

export function RetryBar({ block, sessionId }: { block: Of<'retry'>; sessionId: string }) {
  const [open, setOpen] = useState(false)
  const now = useNow(1000)
  const navigate = useNavigate()
  const left = Math.ceil((block.nextAt - now) / 1000)
  return (
    <div
      data-testid="retry-bar"
      className="overflow-hidden rounded-[12px] border border-warn-line bg-warn-soft"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left"
      >
        <Spinner tone="warn" />
        <span className="flex-1">
          <span className="font-semibold">{t('retry.head')}</span>
          <span className="text-warn-strong">
            {' · '}
            {t('retry.attempt', { n: block.attempt })}
            {' · '}
            {left > 0 ? t('retry.in', { s: left }) : t('retry.now')}
          </span>
        </span>
        <span className="text-[0.923rem] text-warn">{t('retry.safe')}</span>
        <ChevronDown
          size={14}
          className={cx('text-fg-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 pr-3.5 pb-3 pl-9 text-[0.962rem] text-fg-muted">
          <div className="flex gap-2.5">
            <span className="shrink-0 basis-12 text-fg-label">{t('retry.reason')}</span>
            <span className="break-all font-mono text-[0.923rem]">{block.message}</span>
          </div>
          <div className="flex gap-2 pt-0.5">
            <Button className="text-[0.923rem]" onClick={() => void kits.session.abort(sessionId)}>
              {t('retry.stop')}
            </Button>
            <Button
              variant="link"
              className="ml-auto h-7"
              onClick={() => navigate('/settings/model')}
            >
              {t('retry.model')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ErrorCard({
  block,
  session,
  canContinue,
}: {
  block: Of<'error'>
  session: { id: string; kernel: string; model: string; agent: string; workdir: string }
  // 最后一轮、而且现在没有在跑
  canContinue: boolean
}) {
  const { busy, error, run } = useAction()
  const [copied, setCopied] = useState(false)
  const kernel = session.kernel === 'codeagent' ? 'codeagent' : 'opencode'
  const copy = async () => {
    const info = await kits.app.info()
    const text = [
      `kits ${info.version} · ${info.os} · Electron ${info.electron}`,
      `内核 ${kernel} · 模型 ${session.model} · Agent ${session.agent}`,
      `会话 ${session.id}`,
      `工作目录 ${session.workdir}`,
      '',
      block.message,
    ].join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      role="alert"
      data-testid="error-card"
      className="flex flex-col gap-3 rounded-[12px] border border-danger-line bg-danger-soft px-4 py-3.5"
    >
      <div className="flex items-center gap-2">
        <CardIcon tone="danger">
          <AlertCircle size={13} strokeWidth={1.8} />
        </CardIcon>
        <span className="font-semibold">{t('error.head')}</span>
      </div>
      {canContinue ? (
        <p className="m-0 text-[1rem] text-fg-muted leading-[1.6]">
          {block.resend ? t('error.resendBody') : t('error.body')}
        </p>
      ) : null}
      <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[8px] border border-danger-line bg-raised px-3 py-2.5 font-mono text-[0.885rem] text-fg-muted leading-[1.6]">
        {block.message}
      </pre>
      {canContinue ? (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            className="h-8"
            disabled={busy}
            onClick={() =>
              void run(() =>
                kits.session.prompt({
                  id: session.id,
                  text: block.resend ?? t('error.continuePrompt'),
                }),
              )
            }
          >
            {block.resend ? t('error.resend') : t('error.continue')}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => void run(copy)}>
            {copied ? t('error.copied') : t('error.copy')}
          </Button>
          <Button variant="ghost" onClick={() => void run(() => kits.kernel.openLogs(kernel))}>
            {t('error.logs')}
          </Button>
        </div>
      ) : null}
      <ActionError message={error} />
    </div>
  )
}
