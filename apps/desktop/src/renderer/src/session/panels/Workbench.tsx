import type { OutputView, SessionDetail } from '@kits/core/ipc'
import { AtSign, FileText, FolderOpen, X } from 'lucide-react'
import { Tabs as T } from 'radix-ui'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemedToken } from 'shiki/core'
import { t } from '../../app/i18n'
import { languageOf, tokenize } from '../../lib/highlight'
import { kits } from '../../lib/kits'
import { useUi } from '../../lib/ui-store'
import { cx } from '../../ui/cx'
import { Segmented } from '../../ui/Segmented'
import type { ChangedFile, Round } from './derive'
import { FilesPanel } from './FilesPanel'
import { OutputPanel } from './OutputPanel'
import {
  type DiffLine,
  gutterChars,
  type HighlightedSource,
  highlightSource,
  lineTokens,
  oneSided,
  parsePatch,
  splitPath,
  splitRows,
} from './patch'

// 会话页右侧的面板（原型 session.html 的 aside）：文件、改动是常驻页签，文件在前；对话里打开产出时多一个可关闭的页签。工具结果在对话里点开步骤看。
// 放大模式下改动是左右两栏（文件列表 + diff），diff 可以切并排，选择记在 localStorage。

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
  const view = useUi((s) => s.diffView)
  const setView = useUi((s) => s.setDiffView)
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
  // 改动里的“查看完整文件”：切到文件页签，展开它所在的目录
  const viewFile = (path: string) => {
    const parts = path.replace(/\\/g, '/').split('/')
    setFile(parts.join('/'))
    setOpenDirs((set) => {
      const next = new Set(set)
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
    onTab('files')
  }
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
          <T.Trigger value="files" className={TAB}>
            {t('panel.files')}
          </T.Trigger>
          <T.Trigger value="changes" className={TAB}>
            {t('panel.changes')}
            <Count n={files} on={tab === 'changes'} />
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
        <ChangesPanel {...props} view={wide ? view : 'unified'} onViewFile={viewFile} />
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

// 一个文件先渲染这么多行，再多的点“全部显示”：几万行的 diff（生成的文档、锁文件）一次铺开会卡
const LINE_LIMIT = 2_000
// 和文件预览一样，太大的不高亮
const HIGHLIGHT_LINES = 5_000
const HIGHLIGHT_CHARS = 300_000

const TOOL =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg'

// 长行折行。pre-wrap 保留行首缩进；break-all 先把一行填满再折，缩进后面的长 token 不会整个掉到下一行行首
const CODE = 'min-w-0 flex-1 whitespace-pre-wrap break-all'

function stat(additions: number, deletions: number) {
  return (
    <>
      {additions ? <span className="text-ok">+{additions}</span> : null}
      {additions && deletions ? ' ' : null}
      {deletions ? <span className="text-danger">−{deletions}</span> : null}
    </>
  )
}

// 目录在前、文件名在后，空间不够先截目录，文件名尽量完整。
// 两段是 flex 子项，读屏和按名字找按钮时中间会多出空格，所以另放一份完整路径给读屏
function PathLabel({ path, className }: { path: string; className?: string }) {
  const { dir, name } = splitPath(path)
  return (
    <span className={cx('flex min-w-0 flex-1 whitespace-nowrap font-mono', className)} title={path}>
      <span className="sr-only">{path}</span>
      {dir ? (
        <span aria-hidden="true" className="min-w-0 truncate text-fg-label">
          {dir}
        </span>
      ) : null}
      {/* 文件名不参与收缩（哪怕只缩零点几像素也会出省略号），只有比整栏还长时才截 */}
      <span aria-hidden="true" className="max-w-full shrink-0 truncate">
        {name}
      </span>
    </span>
  )
}

function ChangesPanel({
  detail,
  rounds,
  wide,
  view,
  picked,
  onPick,
  onQuote,
  onViewFile,
}: WorkbenchProps & { view: 'unified' | 'split'; onViewFile(path: string): void }) {
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
  const list = useRef<HTMLDivElement>(null)
  // 从对话跳过来时，选中的文件可能在列表下面；用方向键换文件时焦点跟着走
  const pickedRow = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: picked 变了才滚动，列表自己刷新时不动
  useEffect(() => {
    pickedRow.current?.scrollIntoView({ block: 'nearest' })
    if (list.current?.contains(document.activeElement)) pickedRow.current?.focus()
  }, [picked])

  if (!rounds.length) {
    return <Empty title={t('changes.empty')} note={t('changes.emptyNote')} />
  }
  // ↑ ↓ 在所有轮的文件里上下换
  const step = (by: number) => {
    const flat = rounds.flatMap((r) => r.files.map((f) => ({ turn: r.turn, path: f.path })))
    const at = flat.findIndex(
      (x) => x.turn === selected?.round.turn && x.path === selected?.file.path,
    )
    const next = flat[Math.min(flat.length - 1, Math.max(0, at + by))]
    if (next && next !== flat[at]) onPick(next)
  }
  return (
    <div className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div
        ref={list}
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
              </span>
              {/* 标题再长也不能把“进行中”截掉 */}
              {r.pending ? (
                <span className="shrink-0 text-warn-strong">{t('changes.running')}</span>
              ) : null}
              <span className="shrink-0 font-normal">{stat(r.additions, r.deletions)}</span>
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
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                    e.preventDefault()
                    step(e.key === 'ArrowDown' ? 1 : -1)
                  }}
                  className={cx(
                    'flex h-[30px] w-full shrink-0 cursor-pointer items-center gap-2 rounded-[8px] px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
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
                  <PathLabel path={f.path} className="text-[0.929rem]" />
                  <span className="shrink-0 text-[0.857rem]">{stat(f.additions, f.deletions)}</span>
                </button>
              )
            })}
          </div>
        ))}
        <p className="mx-1.5 mt-1.5 mb-0 whitespace-pre-line text-[0.929rem] text-fg-label leading-[1.6]">
          {t('changes.note')}
        </p>
      </div>
      {selected ? (
        <DiffView
          // 换文件时从头看，不留上一个文件的滚动位置
          key={`${selected.round.turn}:${selected.file.path}`}
          file={selected.file}
          pending={selected.round.pending}
          workdir={detail.session.workdir}
          view={view}
          onQuote={onQuote}
          onViewFile={onViewFile}
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

function Num({ n, chars }: { n: number | undefined; chars: number }) {
  return (
    <span
      className="shrink-0 select-none text-right text-fg-subtle"
      style={{ width: `${chars}ch` }}
    >
      {n ?? ''}
    </span>
  )
}

// 加减号不进选区，复制出来的就是代码
function Mark({ kind }: { kind: DiffLine['kind'] }) {
  return <span className="w-[2ch] shrink-0 select-none">{kind === ' ' ? '' : kind}</span>
}

function Code({ line, tokens }: { line: DiffLine; tokens: ThemedToken[] | undefined }) {
  return (
    <span className={CODE}>
      {tokens
        ? tokens.map((token, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一行的 token 不会重排
            <span key={j} className="k-tok" style={token.htmlStyle as CSSProperties}>
              {token.content}
            </span>
          ))
        : line.text}
    </span>
  )
}

// 两侧各高亮一次，按行取回；没有语言、太大或者高亮失败就是纯色
function useTokens(path: string, lines: DiffLine[]) {
  const lang = languageOf(path.replace(/\\/g, '/'))
  const source = useMemo(() => highlightSource(lines), [lines])
  const can =
    !!lang &&
    lines.length <= HIGHLIGHT_LINES &&
    source.old.length + source.new.length <= HIGHLIGHT_CHARS
  // 记下这份 token 是哪份 source 算的：同一个文件的 patch 刷新后组件不换，旧 token 不能拿来显示新内容
  const [done, setDone] = useState<HighlightedSource<ThemedToken[]>>()
  useEffect(() => {
    if (!can || !lang) return
    let gone = false
    const side = (code: string) => (code ? tokenize(code, lang) : Promise.resolve([]))
    void Promise.all([side(source.old), side(source.new)]).then(
      ([o, n]) => {
        if (!gone) setDone({ source, old: o, new: n })
      },
      () => {},
    )
    return () => {
      gone = true
    }
  }, [source, lang, can])
  return (i: number) => lineTokens(source, can ? done : undefined, i)
}

function DiffView({
  file,
  pending,
  workdir,
  view,
  onQuote,
  onViewFile,
}: {
  file: ChangedFile
  pending: boolean
  workdir: string
  view: 'unified' | 'split'
  onQuote(path: string): void
  onViewFile(path: string): void
}) {
  const lines = useMemo(() => parsePatch(file.patch), [file.patch])
  const tokensAt = useTokens(file.path, lines)
  const index = useMemo(() => new Map(lines.map((l, i) => [l, i])), [lines])
  const chars = gutterChars(lines)
  const [all, setAll] = useState(false)
  const sep = workdir.includes('\\') && !workdir.includes('/') ? '\\' : '/'
  // 工作目录外的文件保留的是绝对路径，直接用
  const absolute = /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(file.path)
  const full = absolute ? file.path : `${workdir.replace(/[\\/]+$/, '')}${sep}${file.path}`
  const deleted = file.badge === 'D'
  // 新建、删除的文件只有一侧，并排没意义
  const split = view === 'split' && !oneSided(lines)
  const rows = split ? splitRows(lines) : undefined
  const total = rows ? rows.length : lines.length
  const hidden = all ? 0 : Math.max(0, total - LINE_LIMIT)
  const tokensOf = (l: DiffLine) => tokensAt(index.get(l) ?? -1)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="diff">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-line-soft border-b bg-muted py-1 pr-2 pl-3 text-[0.929rem] text-fg-muted">
        <PathLabel path={file.path} className="font-medium text-fg" />
        <span className="mr-1 shrink-0">{stat(file.additions, file.deletions)}</span>
        <button
          type="button"
          aria-label={t('files.quote')}
          title={t('files.quote')}
          onClick={() => onQuote(file.path)}
          className={TOOL}
        >
          <AtSign size={14} />
        </button>
        {/* 删掉的文件没得看、也没得选中；工作目录外的文件文件页签打不开 */}
        {deleted || absolute ? null : (
          <button
            type="button"
            aria-label={t('changes.viewFile')}
            title={t('changes.viewFile')}
            onClick={() => onViewFile(file.path)}
            className={TOOL}
          >
            <FileText size={14} />
          </button>
        )}
        {/* 只在文件夹里选中，不交给系统默认程序打开：Agent 改的可能是 .bat / .exe，打开就执行了 */}
        {deleted ? null : (
          <button
            type="button"
            aria-label={t('changes.reveal')}
            title={t('changes.reveal')}
            onClick={() => void kits.app.revealPath(full)}
            className={TOOL}
          >
            <FolderOpen size={14} />
          </button>
        )}
      </div>
      {/* 覆盖写之后又改过：下面的 diff 只有覆盖之后的部分 */}
      {file.rewrite && lines.length ? (
        <p className="m-0 shrink-0 border-line-soft border-b bg-warn-soft px-3 py-1.5 text-[0.929rem] text-warn-strong">
          {t('changes.rewritePartial')}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 步骤结果里带了 diff 的，这一轮还在跑也先显示 */}
        {!lines.length ? (
          <p className="m-0 px-3 py-4 text-[0.929rem] text-fg-muted">
            {file.rewrite
              ? t('changes.rewrite')
              : pending
                ? t('changes.pendingDiff')
                : t('changes.binary')}
          </p>
        ) : !rows ? (
          <div className="pb-4 font-mono text-[0.857rem] leading-[1.75]">
            {lines.slice(0, total - hidden).map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff 行没有稳定 id，按位置
              <div key={i} className={cx('flex min-h-[1.75em] px-3', lineTone(l.kind))}>
                <Num n={l.a} chars={chars} />
                <span className="mr-3 ml-2 flex shrink-0">
                  <Num n={l.b} chars={chars} />
                </span>
                {l.kind === '@' ? (
                  <span className={CODE}>{l.text}</span>
                ) : (
                  <>
                    <Mark kind={l.kind} />
                    <Code line={l} tokens={tokensAt(i)} />
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="pb-4 font-mono text-[0.857rem] leading-[1.75]">
            {rows.slice(0, total - hidden).map((row, i) =>
              row.hunk ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 按位置
                <div key={i} className={cx(CODE, 'block px-3', lineTone('@'))}>
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
                        'flex min-h-[1.75em] min-w-0 px-3',
                        side === 0 && 'border-line-soft border-r',
                        l ? lineTone(l.kind) : 'bg-muted',
                      )}
                    >
                      <span className="mr-3 flex shrink-0">
                        <Num n={side === 0 ? l?.a : l?.b} chars={chars} />
                      </span>
                      {l ? <Code line={l} tokens={tokensOf(l)} /> : null}
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        )}
        {hidden ? (
          <div className="flex items-center gap-2 px-3 pb-6 text-[0.929rem] text-fg-muted">
            <span>{t('changes.more', { n: hidden })}</span>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="cursor-pointer text-accent hover:underline"
            >
              {t('changes.showAll')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
