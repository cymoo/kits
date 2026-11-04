import { AlertCircle, Check, ChevronDown, FileText, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { formatDuration, useNow } from '../../lib/use-now'
import { cx } from '../../ui/cx'
import { Spinner } from '../../ui/Spinner'
import { CopyReply } from './CopyReply'
import type { Block } from './derive'
import { Markdown } from './Markdown'
import { STEP_ACTION, STEP_ROW, StepChevron, StepRow } from './Steps'

// 会话页的各种块（原型 session.html）。

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

function turnSummary({ summary, filesChanged }: Extract<Block, { kind: 'turn' }>): string {
  const counts = [
    ['turn.reads', summary.reads],
    ['turn.searches', summary.searches],
    ['turn.edits', filesChanged],
    ['turn.commands', summary.commands],
    ['turn.calls', summary.calls],
  ] as const
  const parts = counts.filter(([, n]) => n > 0).map(([key, n]) => t(key, { n }))
  return parts.join(' · ') || t('turn.think')
}

export function TurnBlock({
  block,
  onOpenFile,
}: {
  block: Extract<Block, { kind: 'turn' }>
  // 点改文件的步骤：在“改动”里打开这一轮的这个文件
  onOpenFile(turn: number, path: string): void
}) {
  const running = block.state === 'running'
  // 运行中默认展开，结束后默认收起；用户点过就听用户的
  const [userOpen, setUserOpen] = useState<boolean>()
  const [thinkOpen, setThinkOpen] = useState(false)
  const open = userOpen ?? running
  const now = useNow(1000, running)
  const elapsed = formatDuration((block.endedAt ?? now) - block.startedAt)
  const summary = turnSummary(block)
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
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 bg-raised px-3 py-1.5 text-left text-fg-muted outline-none hover:bg-active focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
      >
        {block.state === 'done' ? <Check size={14} className="text-ok" strokeWidth={2} /> : null}
        {running ? <Spinner tone="accent" /> : null}
        {block.state === 'failed' ? <AlertCircle size={14} className="text-danger" /> : null}
        <span className="shrink-0 font-medium text-fg">{t('turn.title', { n: block.turn })}</span>
        <span className="min-w-0 flex-1 truncate" title={summary}>
          {summary}
        </span>
        {block.failed ? (
          <span className="shrink-0 text-[0.923rem] text-danger">
            {t('turn.failed', { n: block.failed })}
          </span>
        ) : null}
        <span className="shrink-0 text-[0.923rem] tabular-nums">
          {running
            ? `${t('turn.running')} · ${elapsed}`
            : block.state === 'failed'
              ? `${t('turn.stopped')} · ${elapsed}`
              : elapsed}
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
                className={cx(STEP_ROW, STEP_ACTION)}
              >
                <span className="flex h-5 w-4 shrink-0 items-center justify-center text-fg-subtle">
                  <Lightbulb size={14} strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {block.reasoning.trim().split('\n')[0]}
                </span>
                <StepChevron open={thinkOpen} />
              </button>
              {thinkOpen ? (
                <p className="mt-0 mr-3.5 mb-1.5 ml-[38px] whitespace-pre-wrap border-line border-l-2 px-3 py-2 text-[0.962rem] text-fg-muted leading-[1.65]">
                  {block.reasoning}
                </p>
              ) : null}
            </>
          ) : null}
          {block.steps.map((s) => (
            <StepRow key={s.id} step={s} onOpenFile={(path) => onOpenFile(block.turn, path)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// quiet：复制按钮平时藏着，鼠标移到回复上才出现；最后一条回复做完后一直显示
export function TextBlock({
  block,
  quiet,
}: {
  block: Extract<Block, { kind: 'text' }>
  quiet: boolean
}) {
  return (
    <div className="group flex flex-col gap-1" data-testid="answer">
      <Markdown text={block.text} caret={block.streaming} />
      {block.streaming ? null : <CopyReply text={block.text} quiet={quiet} />}
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
