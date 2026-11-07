import type { PermissionMode } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronDown, ChevronRight, FileText, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { kits } from '../../lib/kits'
import { formatDuration, useNow } from '../../lib/use-now'
import { cx } from '../../ui/cx'
import { Dialog, DialogContent, DialogTrigger } from '../../ui/Dialog'
import { Spinner } from '../../ui/Spinner'
import { AttachmentPreview } from './AttachmentPreview'
import { CopyReply } from './CopyReply'
import type { Block, MessageAttachment } from './derive'
import { Markdown } from './Markdown'
import { STEP_ACTION, STEP_ROW, StepChevron, StepRow } from './Steps'

// 会话页的各种块（原型 session.html）。

const CHIP =
  'inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-line bg-transparent px-2 py-0.5 text-[0.929rem] text-fg-muted [overflow-wrap:anywhere]'

function FileChip({ name }: { name: string }) {
  return (
    <span className={CHIP}>
      <FileText size={12} className="shrink-0" />
      {name}
    </span>
  )
}

// 文档附件：点文件名弹窗预览。弹窗打开时才读文件
function FileAttachment({ id, name }: { id: string; name: string }) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={t('session.viewFile', { name })}
        title={name}
        className={cx(
          CHIP,
          'cursor-pointer outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        <FileText size={12} className="shrink-0" />
        {name}
      </DialogTrigger>
      <DialogContent
        label={name}
        className="flex h-[80vh] w-[880px] max-w-[calc(100%-96px)] flex-col"
      >
        <AttachmentPreview id={id} name={name} />
      </DialogContent>
    </Dialog>
  )
}

// 图片附件：缩略图，点开看大图。原文件被清掉了就退回文件芯片
function ImageAttachment({ id, name }: { id: string; name: string }) {
  const image = useQuery({
    queryKey: ['attachment-image', id],
    queryFn: () => kits.session.attachmentImage(id),
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (!image.data) return <FileChip name={name} />
  return (
    <Dialog>
      <DialogTrigger
        aria-label={t('session.viewImage', { name })}
        title={name}
        className="cursor-zoom-in overflow-hidden rounded-[8px] border border-line bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <img src={image.data} alt={name} className="block max-h-[120px] max-w-[200px]" />
      </DialogTrigger>
      <DialogContent label={name} className="w-auto max-w-[calc(100%-96px)]">
        <img src={image.data} alt={name} className="block max-h-[80vh] max-w-full" />
      </DialogContent>
    </Dialog>
  )
}

function Attachment({ a }: { a: MessageAttachment }) {
  // 旧的插话记录没有 id，取不到文件
  if (!a.id) return <FileChip name={a.name} />
  return a.mime?.startsWith('image/') ? (
    <ImageAttachment id={a.id} name={a.name} />
  ) : (
    <FileAttachment id={a.id} name={a.name} />
  )
}

export function UserBlock({
  text,
  attachments = [],
  pending = false,
}: {
  text: string
  attachments?: MessageAttachment[]
  pending?: boolean
}) {
  return (
    <div className="flex min-w-0 max-w-[84%] flex-col items-end gap-1.5 self-end">
      <div
        data-testid="user-message"
        className="max-w-full whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-active px-3.5 py-2.5 text-[1rem] leading-[1.571] [overflow-wrap:anywhere]"
      >
        {text}
      </div>
      {pending ? (
        <div
          data-testid="interject-pending"
          className="flex items-center gap-1.5 text-[0.929rem] text-fg-subtle"
        >
          <Spinner tone="accent" />
          {t('interject.pending')}
        </div>
      ) : null}
      {attachments.length ? (
        <div className="flex flex-wrap justify-end gap-1.5" data-testid="message-attachments">
          {attachments.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同名附件按位置区分
            <Attachment key={i} a={a} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function turnSummary({ summary, filesChanged }: Extract<Block, { kind: 'turn' }>): string {
  const counts = [
    ['turn.tasks', summary.tasks],
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
  onOpenOutput,
}: {
  block: Extract<Block, { kind: 'turn' }>
  // 点改文件的步骤：在“改动”里打开这一轮的这个文件
  onOpenFile(turn: number, path: string): void
  // 点提交产出的步骤：打开“产出”
  onOpenOutput(): void
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
    <div className="-mt-1 -ml-1" data-testid="turn">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded-[8px] py-0.5 pr-2 pl-1 text-left text-[0.929rem] text-fg-muted outline-none hover:bg-active focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
      >
        <ChevronRight
          size={14}
          className={cx('shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        {running ? <Spinner tone="accent" /> : null}
        {block.state === 'failed' ? <AlertCircle size={14} className="text-danger" /> : null}
        <span className="min-w-0 flex-1 truncate" title={summary}>
          {summary}
        </span>
        {block.failed ? (
          <span className="shrink-0 text-danger">{t('turn.failed', { n: block.failed })}</span>
        ) : null}
        <span className="shrink-0 text-fg-label tabular-nums">
          {running
            ? `${t('turn.running')} · ${elapsed}`
            : block.state === 'failed'
              ? `${t('turn.stopped')} · ${elapsed}`
              : elapsed}
        </span>
      </button>
      {open ? (
        <div className="mt-0.5 ml-2.5 flex flex-col border-line-soft border-l pl-1.5">
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
                <p className="mt-0 mr-2 mb-1.5 ml-8 whitespace-pre-wrap py-0.5 text-[0.929rem] text-fg-muted leading-[1.538]">
                  {block.reasoning}
                </p>
              ) : null}
            </>
          ) : null}
          {block.steps.map((s) =>
            s.live ? (
              <div key={s.id} data-testid="live-text" className="py-1 pr-2 pl-8">
                <Markdown text={s.live.text} caret={s.live.caret} />
              </div>
            ) : (
              <StepRow
                key={s.id}
                step={s}
                onOpenFile={(path) => onOpenFile(block.turn, path)}
                onOpenOutput={onOpenOutput}
              />
            ),
          )}
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
      <Markdown text={block.text} />
      <CopyReply text={block.text} quiet={quiet} />
    </div>
  )
}

export function StatusLine({ block }: { block: Extract<Block, { kind: 'status' }> }) {
  const now = useNow(1000)
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[8px] bg-active px-3 py-[7px] text-[0.929rem] text-fg-muted"
    >
      <Spinner tone="muted" />
      <span className="min-w-0 flex-1 truncate">{block.text}</span>
      {/* 一直有新内容时不显示计时，不然总停在 0 秒 */}
      {now - block.since >= 2_000 ? (
        <span className="shrink-0 text-fg-subtle">{formatDuration(now - block.since)}</span>
      ) : null}
    </div>
  )
}

// 上下文压缩的分隔线（原型 session.html 的 context 场景）：点开看摘要
export function NoticeLine({ block }: { block: Extract<Block, { kind: 'notice' }> }) {
  const text =
    block.setting === 'model'
      ? t('notice.model', { model: block.value.slice(block.value.indexOf('/') + 1) })
      : t('notice.permission', { mode: t(`perm.${block.value as PermissionMode}`) })
  return (
    <div
      data-testid="notice"
      className="flex items-center gap-3 text-[0.857rem] text-fg-label leading-[1.5]"
    >
      <span className="h-px flex-1 bg-line-soft" />
      <span>{text}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  )
}

export function CompactionDivider({ block }: { block: Extract<Block, { kind: 'compaction' }> }) {
  const [open, setOpen] = useState(false)
  const time = new Date(block.at)
  const hm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  if (block.state === 'running') {
    return (
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-[12px] border border-line bg-bg px-3 py-2 text-[0.929rem] text-fg-muted"
      >
        <Spinner tone="muted" />
        <span className="flex-1">{t('compaction.running')}</span>
      </div>
    )
  }
  const label =
    block.state === 'failed'
      ? t('compaction.failed')
      : block.summary
        ? t('compaction.done', { time: hm })
        : t('compaction.auto', { time: hm })
  return (
    <div className="flex flex-col gap-2" data-testid="compaction">
      <div className="flex items-center gap-3 text-[0.857rem] text-fg-label">
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
        <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-[0.929rem]">
          <Markdown text={block.summary} />
        </div>
      ) : null}
    </div>
  )
}
