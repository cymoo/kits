import type { OutputView, SessionDetail } from '@kits/core/ipc'
import { X } from 'lucide-react'
import { Tabs as T } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../app/i18n'
import { kits } from '../../lib/kits'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Segmented } from '../../ui/Segmented'
import type { ChangedFile, Round } from './derive'
import { FilesPanel } from './FilesPanel'
import { OutputPanel } from './OutputPanel'
import { type DiffLine, parsePatch, splitRows } from './patch'

// 会话页右侧的面板（原型 session.html 的 aside）：改动是常驻页签；对话里打开产出时多一个可关闭的页签。工具结果在对话里点开步骤看。
// 放大模式下改动是左右两栏（文件列表 + diff），diff 可以切并排。

export type PanelTab = 'changes' | 'files' | 'output'

// 改动里选中的文件：对话里点改文件的步骤时带这一轮，点文件列表时也一样
export interface PickedFile {
  turn: number
  path: string
}

export interface WorkbenchProps {
  detail: SessionDetail
  rounds: Round[]
  picked: PickedFile | undefined
  onPick(file: PickedFile): void
  outputs: OutputView[]
  // 产出页签打开着
  outputOpen: boolean
  onCloseOutput(): void
  pickedOutput: string | undefined
  onPickOutput(id: string): void
  onExported(path: string): void
  // 预览里的“引用”：把路径填进输入框
  onQuote(path: string): void
  wide: boolean
  tab: PanelTab
  onTab(tab: PanelTab): void
}

const TAB =
  '-mb-px inline-flex h-[34px] cursor-pointer items-center gap-1.5 border-transparent border-b-2 px-2.5 text-[0.929rem] text-fg-muted hover:text-fg data-[state=active]:border-fg data-[state=active]:font-semibold data-[state=active]:text-fg'

function Count({ n, on }: { n: number; on: boolean }) {
  if (!n) return null
  return (
    <span
      className={cx(
        'rounded-[8px] bg-hover px-1.5 font-medium text-[0.857rem]',
        on ? 'text-fg' : 'text-fg-label',
      )}
    >
      {n}
    </span>
  )
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
      <span className="font-medium text-fg">{title}</span>
      <span className="max-w-[240px] text-[0.929rem]">{note}</span>
    </div>
  )
}

export function Workbench(props: WorkbenchProps) {
  const { rounds, wide, tab, onTab } = props
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const files = rounds.reduce((n, r) => n + r.files.length, 0)
  // 切页签时文件页签会卸载，看到哪、展开了什么留在这里
  const [file, setFile] = useState<string>()
  const [openDirs, setOpenDirs] = useState<ReadonlySet<string>>(new Set())
  // 同一个文件改过几轮时取最新一轮的状态
  const changes = useMemo(() => {
    const map = new Map<string, ChangedFile['badge']>()
    for (const r of rounds) for (const f of r.files) if (!map.has(f.path)) map.set(f.path, f.badge)
    return map
  }, [rounds])
  const { session, parts } = props.detail
  const tick = `${session.status}:${parts.filter((p) => p.type === 'tool' && p.status === 'completed').length}`
  return (
    <T.Root
      value={tab}
      onValueChange={(v) => onTab(v as PanelTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-0.5 border-line-soft border-b px-2.5 pt-2">
        <T.List aria-label={t('panel.tabs')} className="flex items-center gap-0.5">
          <T.Trigger value="changes" className={TAB}>
            {t('panel.changes')}
            <Count n={files} on={tab === 'changes'} />
          </T.Trigger>
          <T.Trigger value="files" className={TAB}>
            {t('panel.files')}
          </T.Trigger>
          {props.outputOpen ? (
            <>
              <T.Trigger value="output" className={TAB}>
                {t('panel.output')}
              </T.Trigger>
              <button
                type="button"
                aria-label={t('panel.closeOutput')}
                title={t('panel.closeOutput')}
                onClick={props.onCloseOutput}
                className="-ml-2 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[4px] text-fg-subtle hover:bg-active hover:text-fg"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </>
          ) : null}
        </T.List>
        <span className="flex-1" />
        {wide && tab === 'changes' && files > 0 ? (
          <Segmented
            label={t('panel.view')}
            value={view}
            onChange={setView}
            className="mb-1.5"
            options={[
              { value: 'unified', label: t('panel.unified') },
              { value: 'split', label: t('panel.split') },
            ]}
          />
        ) : null}
      </div>
      <T.Content value="changes" className="flex min-h-0 flex-1 flex-col outline-none">
        <ChangesPanel {...props} view={wide ? view : 'unified'} />
      </T.Content>
      <T.Content value="files" className="flex min-h-0 flex-1 flex-col outline-none">
        <FilesPanel
          workdir={props.detail.session.workdir}
          wide={wide}
          changes={changes}
          file={file}
          onFile={setFile}
          open={openDirs}
          onOpen={(dir) =>
            setOpenDirs((set) => {
              const next = new Set(set)
              if (!next.delete(dir)) next.add(dir)
              return next
            })
          }
          onQuote={props.onQuote}
          tick={tick}
        />
      </T.Content>
      <T.Content value="output" className="flex min-h-0 flex-1 flex-col outline-none">
        <OutputPanel
          outputs={props.outputs}
          picked={props.pickedOutput}
          onPick={props.onPickOutput}
          onExported={props.onExported}
        />
      </T.Content>
    </T.Root>
  )
}

// ---------- 改动 ----------

const BADGE_TONE = {
  A: 'bg-ok-bg text-ok',
  M: 'bg-warn-bg text-warn-strong',
  D: 'bg-danger-bg text-danger',
} as const

function stat(additions: number, deletions: number) {
  return (
    <>
      {additions ? <span className="text-ok">+{additions}</span> : null}
      {additions && deletions ? ' ' : null}
      {deletions ? <span className="text-danger">−{deletions}</span> : null}
    </>
  )
}

function ChangesPanel({
  detail,
  rounds,
  wide,
  view,
  picked,
  onPick,
}: WorkbenchProps & { view: 'unified' | 'split' }) {
  const first = rounds[0]?.files[0]
  // 选中的文件没了（新一轮的改动替换了列表）就回到第一个。这一轮的 diff 里没有时（内核没算出来）找别的轮
  const selected = useMemo(() => {
    const find = (list: Round[]) => {
      for (const r of list) {
        const f = r.files.find((x) => x.path === picked?.path)
        if (f) return { round: r, file: f }
      }
    }
    return (
      find(rounds.filter((r) => r.turn === picked?.turn)) ??
      find(rounds) ??
      (first && rounds[0] ? { round: rounds[0], file: first } : undefined)
    )
  }, [rounds, picked, first])
  // 从对话跳过来时，选中的文件可能在列表下面
  const pickedRow = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: picked 变了才滚动，列表自己刷新时不动
  useEffect(() => {
    pickedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [picked])

  if (!rounds.length) {
    return <Empty title={t('changes.empty')} note={t('changes.emptyNote')} />
  }
  return (
    <div className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div
        data-testid="changed-files"
        className={cx(
          'flex flex-col gap-0.5 overflow-y-auto p-2',
          wide
            ? 'w-[280px] shrink-0 border-line-soft border-r'
            : 'max-h-[42%] shrink-0 border-line-soft border-b pb-1.5',
        )}
      >
        {rounds.map((r) => (
          <div key={r.turn} className="flex flex-col gap-0.5 pb-1.5">
            <div className="flex items-center gap-1.5 px-1.5 pt-1.5 pb-0.5 font-medium text-[0.857rem] text-fg-label">
              <span className="min-w-0 flex-1 truncate" title={r.title}>
                {r.title || t('changes.untitled')}
                {r.pending ? ` · ${t('changes.running')}` : ''}
              </span>
              <span className="font-normal">{stat(r.additions, r.deletions)}</span>
            </div>
            {r.files.map((f) => {
              const on = selected?.round.turn === r.turn && selected.file.path === f.path
              return (
                <button
                  key={f.path}
                  type="button"
                  ref={on ? pickedRow : undefined}
                  aria-pressed={on}
                  onClick={() => onPick({ turn: r.turn, path: f.path })}
                  className={cx(
                    'flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[8px] px-1.5 text-left',
                    on ? 'bg-hover' : 'hover:bg-active',
                  )}
                >
                  <span
                    className={cx(
                      'shrink-0 rounded-[4px] px-[5px] font-semibold text-[0.857rem]',
                      BADGE_TONE[f.badge],
                    )}
                  >
                    {f.badge}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[0.929rem]"
                    title={f.path}
                  >
                    {f.path}
                  </span>
                  <span className="shrink-0 text-[0.857rem]">{stat(f.additions, f.deletions)}</span>
                </button>
              )
            })}
          </div>
        ))}
        <p className="mx-1.5 mt-1.5 mb-0 text-[0.929rem] text-fg-label leading-[1.6]">
          {t('changes.note')}
        </p>
      </div>
      {selected ? (
        <DiffView
          file={selected.file}
          pending={selected.round.pending}
          workdir={detail.session.workdir}
          view={view}
        />
      ) : null}
    </div>
  )
}

function lineTone(kind: DiffLine['kind']) {
  return {
    '+': 'bg-ok-bg/60 text-ok',
    '-': 'bg-danger-bg/60 text-danger',
    '@': 'bg-active text-fg-muted',
    ' ': 'text-fg-muted',
  }[kind]
}

function Num({ n }: { n: number | undefined }) {
  return (
    <span className="inline-block w-7 shrink-0 select-none text-right text-fg-subtle">
      {n ?? ''}
    </span>
  )
}

function DiffView({
  file,
  pending,
  workdir,
  view,
}: {
  file: ChangedFile
  pending: boolean
  workdir: string
  view: 'unified' | 'split'
}) {
  const lines = useMemo(() => parsePatch(file.patch), [file.patch])
  const sep = workdir.includes('\\') && !workdir.includes('/') ? '\\' : '/'
  // 工作目录外的文件保留的是绝对路径，直接用
  const absolute = /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(file.path)
  const full = absolute ? file.path : `${workdir.replace(/[\\/]+$/, '')}${sep}${file.path}`
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="diff">
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-line-soft border-b bg-muted px-3 py-2 text-[0.929rem] text-fg-muted">
        <span className="min-w-0 flex-1 truncate font-medium font-mono text-fg">{file.path}</span>
        <span>{stat(file.additions, file.deletions)}</span>
        {/* 只在文件夹里选中，不交给系统默认程序打开：Agent 改的可能是 .bat / .exe，打开就执行了 */}
        <Button variant="link" onClick={() => void kits.app.revealPath(full)}>
          {t('changes.reveal')}
        </Button>
      </div>
      {pending || !lines.length ? (
        <p className="m-0 px-3 py-4 text-[0.929rem] text-fg-muted">
          {pending ? t('changes.pendingDiff') : t('changes.binary')}
        </p>
      ) : view === 'unified' ? (
        // 行比面板宽时横向滚动，底色要铺满整行
        <div className="w-max min-w-full pb-4 font-mono text-[0.857rem] leading-[1.75]">
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff 行没有稳定 id，按位置
            <div key={i} className={cx('flex whitespace-pre px-3', lineTone(l.kind))}>
              <Num n={l.a} />
              <span className="mr-3 ml-1">
                <Num n={l.b} />
              </span>
              <span>{l.kind === '@' ? l.text : `${l.kind} ${l.text}`}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="pb-4 font-mono text-[0.857rem] leading-[1.75]">
          {splitRows(lines).map((row, i) =>
            row.hunk ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 按位置
              <div key={i} className={cx('whitespace-pre px-3', lineTone('@'))}>
                {row.hunk.text}
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 按位置
              <div key={i} className="grid grid-cols-2">
                {[row.left, row.right].map((l, side) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: 左右两格
                    key={side}
                    className={cx(
                      'flex min-w-0 px-3',
                      side === 0 && 'border-line-soft border-r',
                      l ? (l.kind === ' ' ? lineTone(' ') : lineTone(l.kind)) : 'bg-muted',
                    )}
                  >
                    <span className="mr-3">
                      <Num n={side === 0 ? l?.a : l?.b} />
                    </span>
                    {/* 长行折行显示，pre-wrap 保留行首缩进，不截断 */}
                    <span className="min-w-0 whitespace-pre-wrap break-all">{l ? l.text : ''}</span>
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
