import type { FileEntry } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCode,
  FileCog,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  type LucideIcon,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { type FileKind, fileKind } from '../../lib/file-kind'
import { kits } from '../../lib/kits'
import { cx } from '../../ui/cx'
import { Segmented } from '../../ui/Segmented'
import type { ChangedFile } from './derive'
import { FileBody, isMarkdownFile } from './FileBody'

// 文件页签（原型 session.html 的 isFiles）：目录树一层层懒加载，这个会话改过的文件标 A / M；
// 窄栏点文件进预览，放大后左树右预览。只读。

const BADGE = {
  A: 'bg-ok-bg text-ok',
  M: 'bg-warn-bg text-warn-strong',
  D: 'bg-danger-bg text-danger',
} as const

export type Changes = ReadonlyMap<string, ChangedFile['badge']>

const treeKey = (workdir: string) => ['files', 'tree', workdir]

const row =
  'flex h-[34px] w-full shrink-0 cursor-pointer items-center gap-2 rounded-[8px] pr-2 text-left outline-none hover:bg-active focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset'

// 每层缩进 16px；文件比同层目录多留出箭头的位置
const INDENT = 16
const FILE_PAD = 26

const ICONS: Record<FileKind, [LucideIcon, string]> = {
  doc: [FileText, 'text-accent'],
  pdf: [FileText, 'text-danger'],
  code: [FileCode, 'text-warn'],
  data: [FileCog, 'text-fg-muted'],
  sheet: [FileSpreadsheet, 'text-ok'],
  image: [FileImage, 'text-ok'],
  other: [FileIcon, 'text-fg-subtle'],
}

function Badge({ badge }: { badge: ChangedFile['badge'] }) {
  return (
    <span
      className={cx('shrink-0 rounded-[4px] px-[5px] font-semibold text-[0.857rem]', BADGE[badge])}
    >
      {badge}
    </span>
  )
}

function FileRow({
  entry,
  depth,
  label,
  picked,
  changes,
  onFile,
}: {
  entry: Pick<FileEntry, 'path' | 'name'>
  depth: number
  label?: string
  picked: string | undefined
  changes: Changes
  onFile(path: string): void
}) {
  const badge = changes.get(entry.path)
  const [Icon, tint] = ICONS[fileKind(entry.name)]
  return (
    <button
      type="button"
      aria-pressed={picked === entry.path}
      title={entry.path}
      onClick={() => onFile(entry.path)}
      className={cx(row, picked === entry.path && 'bg-hover')}
      style={{ paddingLeft: depth * INDENT + FILE_PAD }}
    >
      <Icon size={16} strokeWidth={1.5} className={cx('shrink-0', tint)} />
      <span className="min-w-0 flex-1 truncate">{label ?? entry.name}</span>
      {badge ? <Badge badge={badge} /> : null}
    </button>
  )
}

function Dir({
  workdir,
  dir,
  depth,
  picked,
  changes,
  open,
  onOpen,
  onFile,
}: {
  workdir: string
  dir: string
  depth: number
  picked: string | undefined
  changes: Changes
  open: ReadonlySet<string>
  onOpen(dir: string): void
  onFile(path: string): void
}) {
  const entries = useQuery({
    queryKey: [...treeKey(workdir), dir],
    queryFn: () => kits.files.list({ workdir, dir }),
  })
  if (entries.isError) {
    return (
      <p
        className="m-0 py-1 text-[0.929rem] text-danger"
        style={{ paddingLeft: depth * INDENT + FILE_PAD }}
      >
        {errorText(entries.error)}
      </p>
    )
  }
  if (entries.data?.length === 0) {
    return (
      <p
        className="m-0 py-1 text-[0.929rem] text-fg-subtle"
        style={{ paddingLeft: depth * INDENT + FILE_PAD }}
      >
        {t('files.empty')}
      </p>
    )
  }
  return (
    <>
      {entries.data?.map((e) => {
        if (!e.dir) {
          return (
            <FileRow
              key={e.path}
              entry={e}
              depth={depth}
              picked={picked}
              changes={changes}
              onFile={onFile}
            />
          )
        }
        const expanded = open.has(e.path)
        // 收起的目录里有改过的文件时，在目录上也标一下
        const touched = !expanded && [...changes.keys()].some((p) => p.startsWith(`${e.path}/`))
        return (
          <div key={e.path} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              title={e.path}
              onClick={() => onOpen(e.path)}
              className={row}
              style={{ paddingLeft: depth * INDENT + 6 }}
            >
              <ChevronRight
                size={12}
                className={cx(
                  'shrink-0 text-fg-subtle transition-transform',
                  expanded && 'rotate-90',
                )}
              />
              <Folder size={16} strokeWidth={1.5} className="shrink-0 text-fg-label" />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {touched ? (
                <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-warn" />
              ) : null}
            </button>
            {expanded ? (
              <Dir
                workdir={workdir}
                dir={e.path}
                depth={depth + 1}
                picked={picked}
                changes={changes}
                open={open}
                onOpen={onOpen}
                onFile={onFile}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function Tree({
  workdir,
  wide,
  picked,
  changes,
  open,
  onOpen,
  onFile,
}: {
  workdir: string
  wide: boolean
  picked: string | undefined
  changes: Changes
  open: ReadonlySet<string>
  onOpen(dir: string): void
  onFile(path: string): void
}) {
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const found = useQuery({
    queryKey: ['files', workdir, q],
    queryFn: () => kits.files.search({ workdir, query: q }),
    enabled: !!q,
  })
  return (
    <div
      className={cx(
        'flex min-h-0 flex-col',
        wide ? 'w-[280px] shrink-0 border-line-soft border-r' : 'flex-1',
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5">
        <input
          aria-label={t('files.filter')}
          placeholder={t('files.filter')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-[8px] border border-line bg-raised px-2.5 text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <button
          type="button"
          aria-label={t('files.refresh')}
          title={t('files.refresh')}
          onClick={() => void client.invalidateQueries({ queryKey: ['files'] })}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-fg-muted hover:bg-active hover:text-fg"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div
        data-testid="file-tree"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-2"
      >
        {q ? (
          <>
            {found.data?.map((path) => (
              <FileRow
                key={path}
                entry={{ path, name: path }}
                depth={-1}
                label={path}
                picked={picked}
                changes={changes}
                onFile={onFile}
              />
            ))}
            {found.data?.length === 0 ? (
              <p className="m-0 py-4 text-center text-[0.929rem] text-fg-label">
                {t('files.noMatch')}
              </p>
            ) : null}
          </>
        ) : (
          <Dir
            workdir={workdir}
            dir=""
            depth={0}
            picked={picked}
            changes={changes}
            open={open}
            onOpen={onOpen}
            onFile={onFile}
          />
        )}
      </div>
    </div>
  )
}

function FileView({
  workdir,
  path,
  wide,
  onBack,
  onQuote,
}: {
  workdir: string
  path: string
  wide: boolean
  onBack(): void
  onQuote(path: string): void
}) {
  const preview = useQuery({
    queryKey: [...treeKey(workdir), 'read', path],
    queryFn: () => kits.files.read({ workdir, path }),
  })
  const [source, setSource] = useState(false)
  const [openError, setOpenError] = useState<string>()
  const data = preview.data
  const open = () => {
    setOpenError(undefined)
    kits.files.open({ workdir, path }).catch((e) => setOpenError(errorText(e)))
  }
  const tool =
    'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg'
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-raised" data-testid="file-preview">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-line-soft border-b px-2 py-1">
        {wide ? null : (
          <button
            type="button"
            aria-label={t('files.back')}
            title={t('files.back')}
            onClick={onBack}
            className={tool}
          >
            <ChevronLeft size={15} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate pl-1 font-mono text-[0.929rem]" title={path}>
          {path}
        </span>
        {isMarkdownFile(path) && data?.kind === 'text' ? (
          <Segmented
            label={t('panel.view')}
            value={source ? 'source' : 'rendered'}
            onChange={(v) => setSource(v === 'source')}
            options={[
              { value: 'rendered', label: t('files.rendered') },
              { value: 'source', label: t('files.source') },
            ]}
          />
        ) : null}
        <button
          type="button"
          aria-label={t('files.quote')}
          title={t('files.quote')}
          onClick={() => onQuote(path)}
          className={tool}
        >
          <AtSign size={14} />
        </button>
        <button
          type="button"
          aria-label={t('files.open')}
          title={t('files.open')}
          onClick={open}
          className={tool}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      {openError ? (
        <p className="m-0 shrink-0 border-line-soft border-b bg-danger-bg/60 px-3 py-1.5 text-[0.929rem] text-danger">
          {openError}
        </p>
      ) : null}
      {data?.kind === 'text' && data.truncated ? (
        <p className="m-0 shrink-0 border-line-soft border-b bg-warn-soft px-3 py-1.5 text-[0.929rem] text-warn-strong">
          {t('files.truncated')}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.isError ? (
          <p className="m-0 p-6 text-center text-[0.929rem] text-danger">
            {t('files.readError', { error: errorText(preview.error) })}
          </p>
        ) : null}
        {data ? <FileBody name={path} preview={data} source={source} onOpen={open} /> : null}
      </div>
    </div>
  )
}

export function FilesPanel({
  workdir,
  wide,
  changes,
  file,
  onFile,
  open,
  onOpen,
  onQuote,
  tick,
}: {
  workdir: string
  wide: boolean
  changes: Changes
  file: string | undefined
  onFile(path: string | undefined): void
  open: ReadonlySet<string>
  onOpen(dir: string): void
  onQuote(path: string): void
  // Agent 改了东西时变，展开着的目录和正看的文件跟着刷新
  tick: string
}) {
  const client = useQueryClient()
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick 变了才刷新
  useEffect(() => {
    void client.invalidateQueries({ queryKey: treeKey(workdir) })
  }, [tick])
  return (
    <div className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      {wide || !file ? (
        <Tree
          workdir={workdir}
          wide={wide}
          picked={file}
          changes={changes}
          open={open}
          onOpen={onOpen}
          onFile={onFile}
        />
      ) : null}
      {file ? (
        <FileView
          key={file}
          workdir={workdir}
          path={file}
          wide={wide}
          onBack={() => onFile(undefined)}
          onQuote={onQuote}
        />
      ) : wide ? (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-raised text-[0.929rem] text-fg-label">
          {t('files.pick')}
        </div>
      ) : null}
    </div>
  )
}
