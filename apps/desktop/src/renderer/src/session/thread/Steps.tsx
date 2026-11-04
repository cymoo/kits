import {
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Bot,
  ChevronRight,
  FilePlus,
  FileText,
  Globe,
  ListTodo,
  MessageSquare,
  Pencil,
  Plug,
  Search,
  Terminal,
  Upload,
  Wrench,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { t } from '../../app/i18n'
import { formatDuration, useNow } from '../../lib/use-now'
import { cx } from '../../ui/cx'
import { Spinner } from '../../ui/Spinner'
import { CopyIcon } from './CopyReply'
import { clipOutput, type Step, type StepIcon } from './derive'

// 工作过程里的一步（原型 session.html）：图标 + 标题，点开就地看结果；改文件的步骤跳到“改动”。

const ICONS: Record<StepIcon, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  read: FileText,
  search: Search,
  command: Terminal,
  edit: Pencil,
  new: FilePlus,
  web: Globe,
  task: Bot,
  plan: ListTodo,
  skill: BookOpen,
  memory: Bookmark,
  output: Upload,
  platform: Plug,
  note: MessageSquare,
  tool: Wrench,
}

// 悬浮或聚焦时才显示的展开、跳转图标；已展开的一直显示
const HINT =
  'flex h-5 w-3.5 shrink-0 items-center justify-center text-fg-muted opacity-0 group-hover/step:opacity-100 group-focus-visible/step:opacity-100'

export const STEP_ROW =
  'group/step flex w-full items-start gap-2 rounded-[6px] px-3.5 py-1 text-left text-[0.962rem] outline-none'
export const STEP_ACTION =
  'cursor-pointer hover:bg-active focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset'

export function StepChevron({ open }: { open: boolean }) {
  return (
    <span className={cx(HINT, open && 'opacity-100')}>
      <ChevronRight size={12} className={cx(open && 'rotate-90')} />
    </span>
  )
}

function Section({
  text,
  copy,
  label,
  command,
  first,
  clipped,
}: {
  text: string
  copy: string
  label?: string
  command?: boolean
  first?: boolean
  clipped?: { hidden: number; shown: string; before: boolean; onShow(): void }
}) {
  const more = clipped?.hidden ? (
    <button
      type="button"
      onClick={clipped.onShow}
      className="block h-[26px] w-full cursor-pointer px-2.5 text-left text-[0.885rem] text-fg-muted outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
    >
      {t(clipped.before ? 'step.moreBefore' : 'step.moreAfter', { n: clipped.hidden })}
    </button>
  ) : null
  return (
    <div
      className={cx(
        'group/out relative',
        !first && 'border-line-soft border-t',
        command && 'bg-panel',
      )}
    >
      {label ? <div className="px-2.5 pt-1.5 text-[0.846rem] text-fg-muted">{label}</div> : null}
      {clipped?.before ? more : null}
      <pre
        className={cx(
          'm-0 overflow-y-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[0.885rem] leading-[1.6] [overflow-wrap:anywhere]',
          clipped?.hidden ? 'max-h-none' : 'max-h-[480px]',
          command
            ? "text-fg before:select-none before:text-fg-subtle before:content-['$_']"
            : 'text-fg-muted',
        )}
      >
        {clipped?.shown ?? text}
      </pre>
      {clipped && !clipped.before ? more : null}
      <CopyIcon
        text={text}
        label={copy}
        className={cx(
          'absolute top-1 right-1 opacity-0 focus-visible:opacity-100 group-hover/out:opacity-100',
          command ? 'bg-panel' : 'bg-raised',
        )}
      />
    </div>
  )
}

function StepBody({ step }: { step: Step }) {
  const [all, setAll] = useState(false)
  const output = step.output ?? ''
  const clip = all
    ? { text: output, hidden: 0 }
    : clipOutput(output, step.command ? 'tail' : 'head')
  return (
    <div
      data-testid="step-output"
      className="mt-0.5 mr-3.5 mb-1.5 ml-[38px] overflow-hidden rounded-[8px] border border-line-soft bg-raised"
    >
      {step.command ? (
        <Section text={step.detail} copy={t('step.copyCommand')} command first />
      ) : null}
      {step.args ? (
        <Section text={step.args} copy={t('step.copyArgs')} label={t('step.args')} first />
      ) : null}
      {output ? (
        <Section
          text={output}
          copy={t(
            step.command
              ? 'step.copyOutput'
              : step.args
                ? 'step.copyResultOfCall'
                : 'step.copyResult',
          )}
          first={!step.command && !step.args}
          {...(step.args ? { label: t('step.result') } : {})}
          clipped={{
            hidden: clip.hidden,
            shown: clip.text,
            before: !!step.command,
            onShow: () => setAll(true),
          }}
        />
      ) : (
        <div className="border-line-soft border-t px-2.5 py-2 text-[0.923rem] text-fg-muted">
          {t(step.state === 'running' ? 'step.outputLater' : 'step.noOutput')}
        </div>
      )}
      {step.foot ? (
        <div className="border-line-soft border-t px-2.5 py-[5px] text-[0.885rem] text-fg-muted tabular-nums">
          {step.foot}
        </div>
      ) : null}
    </div>
  )
}

export function StepRow({ step, onOpenFile }: { step: Step; onOpenFile(path: string): void }) {
  // 失败的默认展开；用户点过就听用户的
  const [userOpen, setUserOpen] = useState<boolean>()
  const expandable = !step.file && (!!step.command || !!step.output || !!step.args)
  const open = expandable && (userOpen ?? !!step.failed)
  const now = useNow(1000, step.startedAt !== undefined)
  const meta =
    step.meta ?? (step.startedAt !== undefined ? formatDuration(now - step.startedAt) : '')
  const Icon = ICONS[step.icon]
  const { file } = step
  const content = (
    <>
      <span
        className={cx(
          'flex h-5 w-4 shrink-0 items-center justify-center',
          step.state === 'error' ? 'text-danger' : 'text-fg-subtle',
        )}
      >
        {step.state === 'running' ? (
          <Spinner tone="muted" size={11} />
        ) : (
          <Icon size={14} strokeWidth={1.6} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {step.desc ? (
          <>
            <span className="truncate">{step.desc}</span>
            {step.detail && !open ? (
              <span className="truncate font-mono text-[0.846rem] text-fg-muted leading-[18px]">
                {step.detail}
              </span>
            ) : null}
          </>
        ) : (
          <span className="truncate">
            <span className="text-fg-muted">{step.verb}</span>{' '}
            <span className="font-mono text-[0.923rem]">{step.detail}</span>
          </span>
        )}
      </span>
      {meta ? (
        <span
          className={cx(
            'shrink-0 text-[0.923rem] tabular-nums leading-5',
            step.state === 'error' ? 'text-danger' : step.isStat ? 'text-ok' : 'text-fg-muted',
          )}
        >
          {meta}
        </span>
      ) : null}
      {expandable ? <StepChevron open={open} /> : null}
      {file ? (
        <span className={HINT}>
          <ArrowUpRight size={12} />
        </span>
      ) : null}
    </>
  )
  return (
    <>
      {expandable || file ? (
        <button
          type="button"
          data-testid="step"
          title={step.command ? step.detail : undefined}
          {...(expandable ? { 'aria-expanded': open } : {})}
          onClick={() => (file ? onOpenFile(file) : setUserOpen(!open))}
          className={cx(STEP_ROW, STEP_ACTION)}
        >
          {content}
        </button>
      ) : (
        <div data-testid="step" className={STEP_ROW}>
          {content}
        </div>
      )}
      {open ? <StepBody step={step} /> : null}
    </>
  )
}
