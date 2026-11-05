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
import { TodoList } from './Plan'

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
  'group/step flex w-full items-start gap-2 rounded-[8px] px-2 py-[3px] text-left text-[0.929rem] outline-none'
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
      className="block h-[26px] w-full cursor-pointer px-2.5 text-left text-[0.857rem] text-fg-muted outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
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
      {label ? <div className="px-2.5 pt-1.5 text-[0.857rem] text-fg-muted">{label}</div> : null}
      {clipped?.before ? more : null}
      <pre
        className={cx(
          'm-0 overflow-y-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[0.857rem] leading-[1.6] [overflow-wrap:anywhere]',
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

// 子任务里默认放这么多步，留最后的：跑着的时候要看的是它现在在做什么
const SUB_STEPS = 8

function SubSteps({
  steps,
  onOpenFile,
  onOpenOutput,
}: {
  steps: Step[]
  onOpenFile(path: string): void
  onOpenOutput(): void
}) {
  const [all, setAll] = useState(false)
  const hidden = all ? 0 : Math.max(0, steps.length - SUB_STEPS)
  return (
    <div className="border-line-soft border-t" data-testid="sub-steps">
      <div className="px-2.5 pt-1.5 text-[0.857rem] text-fg-muted">{t('step.process')}</div>
      {hidden ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="block h-[26px] w-full cursor-pointer px-2.5 text-left text-[0.857rem] text-fg-muted outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
        >
          {t('step.moreSteps', { n: hidden })}
        </button>
      ) : null}
      <div className="flex flex-col py-1">
        {steps.slice(hidden).map((s) => (
          <StepRow key={s.id} step={s} onOpenFile={onOpenFile} onOpenOutput={onOpenOutput} nested />
        ))}
      </div>
    </div>
  )
}

function StepBody({
  step,
  nested,
  onOpenFile,
  onOpenOutput,
}: {
  step: Step
  nested?: boolean
  onOpenFile(path: string): void
  onOpenOutput(): void
}) {
  const [all, setAll] = useState(false)
  const output = step.output ?? ''
  const clip = all
    ? { text: output, hidden: 0 }
    : clipOutput(output, step.command ? 'tail' : 'head')
  return (
    <div
      data-testid="step-output"
      className={cx(
        'mt-0.5 mb-1.5 overflow-hidden rounded-[8px] border border-line-soft bg-raised',
        nested ? 'mr-2.5 ml-[34px]' : 'mr-2 ml-8',
      )}
    >
      {step.prompt ? (
        <Section text={step.prompt} copy={t('step.copyPrompt')} label={t('step.prompt')} first />
      ) : null}
      {step.subSteps?.length ? (
        <SubSteps steps={step.subSteps} onOpenFile={onOpenFile} onOpenOutput={onOpenOutput} />
      ) : null}
      {step.todos ? <TodoList items={step.todos} /> : null}
      {step.command ? (
        <Section text={step.detail} copy={t('step.copyCommand')} command first />
      ) : null}
      {step.args ? (
        <Section text={step.args} copy={t('step.copyArgs')} label={t('step.args')} first />
      ) : null}
      {step.todos ? null : output ? (
        <Section
          text={output}
          copy={t(
            step.command
              ? 'step.copyOutput'
              : step.args
                ? 'step.copyResultOfCall'
                : 'step.copyResult',
          )}
          first={!step.command && !step.args && !step.prompt}
          {...(step.args ? { label: t('step.result') } : {})}
          {...(step.subSteps ? { label: t('step.taskResult') } : {})}
          clipped={{
            hidden: clip.hidden,
            shown: clip.text,
            before: !!step.command,
            onShow: () => setAll(true),
          }}
        />
      ) : step.subSteps ? null : (
        <div className="border-line-soft border-t px-2.5 py-2 text-[0.929rem] text-fg-muted">
          {t(step.state === 'running' ? 'step.outputLater' : 'step.noOutput')}
        </div>
      )}
      {step.foot ? (
        <div className="border-line-soft border-t px-2.5 py-[5px] text-[0.857rem] text-fg-muted tabular-nums">
          {step.foot}
        </div>
      ) : null}
    </div>
  )
}

export function StepRow({
  step,
  onOpenFile,
  onOpenOutput,
  nested,
}: {
  step: Step
  onOpenFile(path: string): void
  onOpenOutput(): void
  // 子任务里的一步
  nested?: boolean
}) {
  // 失败的、在跑的子任务默认展开；用户点过就听用户的
  const [userOpen, setUserOpen] = useState<boolean>()
  const expandable =
    !step.file &&
    (!!step.command || !!step.output || !!step.args || !!step.subSteps || !!step.todos)
  const open =
    expandable && (userOpen ?? (!!step.failed || (!!step.subSteps && step.state === 'running')))
  const now = useNow(1000, step.startedAt !== undefined)
  const elapsed = step.startedAt !== undefined ? formatDuration(now - step.startedAt) : ''
  const counted = step.subSteps?.length ? t('step.subCount', { n: step.subSteps.length }) : ''
  const meta = step.meta ?? [counted, elapsed].filter(Boolean).join(' · ')
  const Icon = ICONS[step.icon]
  const { file, toOutput } = step
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
              <span className="truncate font-mono text-[0.857rem] text-fg-muted leading-[18px]">
                {step.detail}
              </span>
            ) : null}
          </>
        ) : (
          <span className="truncate">
            <span className="text-fg-muted">{step.verb}</span>{' '}
            <span className="font-mono text-[0.929rem]">{step.detail}</span>
          </span>
        )}
      </span>
      {meta ? (
        <span
          className={cx(
            'shrink-0 text-[0.929rem] tabular-nums leading-5',
            step.state === 'error' ? 'text-danger' : step.isStat ? 'text-ok' : 'text-fg-muted',
          )}
        >
          {meta}
        </span>
      ) : null}
      {expandable ? <StepChevron open={open} /> : null}
      {file || toOutput ? (
        <span className={HINT}>
          <ArrowUpRight size={12} />
        </span>
      ) : null}
    </>
  )
  return (
    <>
      {expandable || file || toOutput ? (
        <button
          type="button"
          data-testid="step"
          title={step.command ? step.detail : undefined}
          {...(expandable ? { 'aria-expanded': open } : {})}
          onClick={() => (file ? onOpenFile(file) : toOutput ? onOpenOutput() : setUserOpen(!open))}
          className={cx(STEP_ROW, STEP_ACTION, nested && 'px-2.5')}
        >
          {content}
        </button>
      ) : (
        <div data-testid="step" className={cx(STEP_ROW, nested && 'px-2.5')}>
          {content}
        </div>
      )}
      {open ? (
        <StepBody
          step={step}
          nested={!!nested}
          onOpenFile={onOpenFile}
          onOpenOutput={onOpenOutput}
        />
      ) : null}
    </>
  )
}
