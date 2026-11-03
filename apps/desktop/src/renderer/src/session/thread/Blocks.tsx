import { AlertCircle, Check, ChevronDown, FileText } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { formatDuration, useNow } from '../../lib/use-now'
import { cx } from '../../ui/cx'
import type { Block, Step } from './derive'
import { Markdown } from './Markdown'

// 会话页的各种块（原型 session.html）。

export function Spinner({
  tone = 'accent',
  size = 12,
}: {
  tone?: 'accent' | 'warn' | 'muted'
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        'inline-block shrink-0 animate-spin rounded-full border-2',
        tone === 'accent' && 'border-accent-bg border-t-accent',
        tone === 'warn' && 'border-warn-bg border-t-warn',
        tone === 'muted' && 'border-line border-t-accent',
      )}
    />
  )
}

export function UserBlock({
  text,
  attachments = [],
}: {
  text: string
  attachments?: { name: string; size: number }[]
}) {
  return (
    <div className="flex max-w-[84%] flex-col items-end gap-1.5 self-end">
      <div
        data-testid="user-message"
        className="whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-active px-3.5 py-2.5 text-[1.077rem] leading-[1.6]"
      >
        {text}
      </div>
      {attachments.length ? (
        <div className="flex flex-wrap justify-end gap-1.5" data-testid="message-attachments">
          {attachments.map((a, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 同名附件按位置区分
              key={i}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-line px-2 py-0.5 text-[0.923rem] text-fg-muted"
            >
              <FileText size={12} />
              {a.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StepRow({ step }: { step: Step }) {
  return (
    <div
      className="flex items-baseline gap-2.5 py-1 pr-3.5 pl-[34px] text-[0.962rem]"
      data-testid="step"
    >
      <span className="shrink-0 basis-14 text-fg-muted">{step.kind}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[0.923rem]" title={step.detail}>
        {step.detail}
      </span>
      {step.state === 'running' ? <Spinner tone="muted" size={11} /> : null}
      {step.meta ? (
        <span
          className={cx(
            'shrink-0 text-[0.923rem]',
            step.state === 'error' ? 'text-danger' : 'text-fg-subtle',
          )}
        >
          {step.meta}
        </span>
      ) : null}
    </div>
  )
}

export function TurnBlock({ block }: { block: Extract<Block, { kind: 'turn' }> }) {
  const running = block.state === 'running'
  // 运行中默认展开，结束后默认收起；用户点过就听用户的
  const [userOpen, setUserOpen] = useState<boolean>()
  const [thinkOpen, setThinkOpen] = useState(false)
  const open = userOpen ?? running
  const now = useNow(1000, running)
  const elapsed = formatDuration((block.endedAt ?? now) - block.startedAt)
  const meta = [
    running ? t('turn.running') : null,
    t('turn.steps', { n: block.steps.length }),
    elapsed,
    block.filesChanged > 0 ? t('turn.files', { n: block.filesChanged }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className={cx(
        'overflow-hidden rounded-[12px] border',
        running ? 'border-accent/25' : 'border-line-soft',
      )}
      data-testid="turn"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 bg-raised px-3 py-1.5 text-left text-fg-muted hover:bg-active"
      >
        {block.state === 'done' ? <Check size={14} className="text-ok" strokeWidth={2} /> : null}
        {running ? <Spinner /> : null}
        {block.state === 'failed' ? <AlertCircle size={14} className="text-danger" /> : null}
        <span className="flex-1">
          <span className="font-medium text-fg">{t('turn.title', { n: block.turn })}</span> · {meta}
        </span>
        <ChevronDown
          size={14}
          className={cx('text-fg-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="flex flex-col border-line-soft border-t bg-bg/40 pt-1 pb-2">
          {block.reasoning ? (
            <>
              <button
                type="button"
                aria-expanded={thinkOpen}
                onClick={() => setThinkOpen(!thinkOpen)}
                className="flex cursor-pointer items-baseline gap-2.5 py-1 pr-3.5 pl-[34px] text-left text-[0.962rem] hover:bg-active"
              >
                <span className="shrink-0 basis-14 text-fg-muted">{t('turn.think')}</span>
                <span className="min-w-0 flex-1 truncate">
                  {block.reasoning.trim().split('\n')[0]}
                </span>
                <span className="text-[0.923rem] text-fg-subtle">
                  {thinkOpen ? t('turn.collapse') : t('turn.expand')}
                </span>
              </button>
              {thinkOpen ? (
                <p className="mt-0 mr-3.5 mb-1.5 ml-[100px] whitespace-pre-wrap border-line border-l-2 px-3 py-2 text-[0.962rem] text-fg-muted leading-[1.65]">
                  {block.reasoning}
                </p>
              ) : null}
            </>
          ) : null}
          {block.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function TextBlock({ block }: { block: Extract<Block, { kind: 'text' }> }) {
  return (
    <div className="flex flex-col gap-2" data-testid="answer">
      <Markdown text={block.text} caret={block.streaming} />
    </div>
  )
}

export function StatusLine({ block }: { block: Extract<Block, { kind: 'status' }> }) {
  const now = useNow(1000)
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[8px] bg-active px-3 py-[7px] text-[0.962rem] text-fg-muted"
    >
      <Spinner tone="muted" />
      <span className="flex-1">{block.text}</span>
      <span className="text-fg-subtle">{formatDuration(now - block.since)}</span>
    </div>
  )
}

// 上下文压缩的分隔线（原型 session.html 的 context 场景）：点开看摘要
export function CompactionDivider({ block }: { block: Extract<Block, { kind: 'compaction' }> }) {
  const [open, setOpen] = useState(false)
  const time = new Date(block.at)
  const hm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  if (block.state === 'running') {
    return (
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-[10px] border border-line bg-bg px-3 py-2 text-[0.962rem] text-fg-muted"
      >
        <Spinner tone="muted" />
        <span className="flex-1">{t('compaction.running', { n: block.turns })}</span>
      </div>
    )
  }
  const label =
    block.state === 'failed'
      ? t('compaction.failed')
      : block.summary
        ? t('compaction.done', { n: block.turns, time: hm })
        : t('compaction.auto', { time: hm })
  return (
    <div className="flex flex-col gap-2" data-testid="compaction">
      <div className="flex items-center gap-3 text-[0.885rem] text-fg-label">
        <span className="h-px flex-1 bg-line" />
        {block.summary ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-1.5 py-0.5 hover:bg-active hover:text-fg"
          >
            {label}
            <ChevronDown size={12} className={cx('transition-transform', open && 'rotate-180')} />
          </button>
        ) : (
          <span className={cx(block.state === 'failed' && 'text-danger')}>{label}</span>
        )}
        <span className="h-px flex-1 bg-line" />
      </div>
      {open && block.summary ? (
        <div className="rounded-[10px] border border-line bg-bg px-4 py-3 text-[0.962rem]">
          <Markdown text={block.summary} />
        </div>
      ) : null}
    </div>
  )
}
