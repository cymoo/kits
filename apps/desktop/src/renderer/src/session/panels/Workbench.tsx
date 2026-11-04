import type { OutputView, SessionDetail } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { SquareTerminal } from 'lucide-react'
import { Tabs as T } from 'radix-ui'
import { type ReactNode, useMemo, useState } from 'react'
import { t } from '../../app/i18n'
import { kits, useHomeLabel } from '../../lib/kits'
import { formatDuration } from '../../lib/use-now'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Segmented } from '../../ui/Segmented'
import { Spinner } from '../thread/Blocks'
import { type ChangedFile, type Command, formatTokens, type Round, type Usage } from './derive'
import { OutputPanel } from './OutputPanel'
import { type DiffLine, parsePatch, splitRows } from './patch'

// 会话页右侧的工作区面板（原型 session.html 的 aside）：改动、产出、命令、上下文四个页签。
// 放大模式下改动是左右两栏（文件列表 + diff），diff 可以切并排。

export type PanelTab = 'changes' | 'output' | 'terminal' | 'context'

export interface WorkbenchProps {
  detail: SessionDetail
  rounds: Round[]
  commands: Command[]
  rules: string[]
  outputs: OutputView[]
  usage: Usage
  // 当前模型的上下文窗口；不知道时为 0
  contextWindow: number
  wide: boolean
  tab: PanelTab
  onTab(tab: PanelTab): void
}

function Count({ n, on }: { n: number; on: boolean }) {
  if (!n) return null
  return (
    <span
      className={cx(
        'rounded-[8px] bg-hover px-1.5 font-medium text-[0.846rem]',
        on ? 'text-fg' : 'text-fg-label',
      )}
    >
      {n}
    </span>
  )
}

function Empty({ icon, title, note }: { icon?: ReactNode; title: string; note: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
      {icon}
      <span className="font-medium text-fg">{title}</span>
      <span className="max-w-[240px] text-[0.923rem]">{note}</span>
    </div>
  )
}

export function Workbench(props: WorkbenchProps) {
  const { rounds, commands, wide, tab, onTab } = props
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const files = rounds.reduce((n, r) => n + r.files.length, 0)
  return (
    <T.Root
      value={tab}
      onValueChange={(v) => onTab(v as PanelTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-0.5 border-line-soft border-b px-2.5 pt-2">
        <T.List aria-label={t('panel.tabs')} className="flex gap-0.5">
          {(
            [
              ['changes', t('panel.changes'), files],
              ['output', t('panel.output'), 0],
              ['terminal', t('panel.terminal'), commands.length],
              ['context', t('panel.context'), 0],
            ] as const
          ).map(([value, label, n]) => (
            <T.Trigger
              key={value}
              value={value}
              className="-mb-px inline-flex h-[34px] cursor-pointer items-center gap-1.5 border-transparent border-b-2 px-2.5 text-[0.962rem] text-fg-muted hover:text-fg data-[state=active]:border-fg data-[state=active]:font-semibold data-[state=active]:text-fg"
            >
              {label}
              <Count n={n} on={tab === value} />
            </T.Trigger>
          ))}
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
      <T.Content value="output" className="flex min-h-0 flex-1 flex-col outline-none">
        <OutputPanel
          outputs={props.outputs}
          running={
            props.detail.session.status === 'running' || props.detail.session.status === 'waiting'
          }
          agent={props.detail.session.agent}
        />
      </T.Content>
      <T.Content value="terminal" className="flex min-h-0 flex-1 flex-col outline-none">
        <TerminalPanel commands={commands} rules={props.rules} />
      </T.Content>
      <T.Content value="context" className="flex min-h-0 flex-1 flex-col outline-none">
        <ContextPanel {...props} />
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
}: WorkbenchProps & { view: 'unified' | 'split' }) {
  const first = rounds[0]?.files[0]
  const [picked, setPicked] = useState<{ turn: number; path: string }>()
  // 选中的文件没了（新一轮的改动替换了列表）就回到第一个
  const selected = useMemo(() => {
    for (const r of rounds) {
      if (r.turn !== picked?.turn) continue
      const f = r.files.find((x) => x.path === picked.path)
      if (f) return { round: r, file: f }
    }
    return first && rounds[0] ? { round: rounds[0], file: first } : undefined
  }, [rounds, picked, first])

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
            <div className="flex items-center gap-1.5 px-1.5 pt-1.5 pb-0.5 font-medium text-[0.885rem] text-fg-label">
              <span className="min-w-0 flex-1">
                {t('changes.round', { n: r.turn })}
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
                  aria-pressed={on}
                  onClick={() => setPicked({ turn: r.turn, path: f.path })}
                  className={cx(
                    'flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[7px] px-1.5 text-left',
                    on ? 'bg-hover' : 'hover:bg-active',
                  )}
                >
                  <span
                    className={cx(
                      'shrink-0 rounded-[4px] px-[5px] font-semibold text-[0.808rem]',
                      BADGE_TONE[f.badge],
                    )}
                  >
                    {f.badge}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[0.923rem]"
                    title={f.path}
                  >
                    {f.path}
                  </span>
                  <span className="shrink-0 text-[0.885rem]">{stat(f.additions, f.deletions)}</span>
                </button>
              )
            })}
          </div>
        ))}
        <p className="mx-1.5 mt-1.5 mb-0 text-[0.923rem] text-fg-label leading-[1.6]">
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
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-line-soft border-b bg-muted px-3 py-2 text-[0.923rem] text-fg-muted">
        <span className="min-w-0 flex-1 truncate font-medium font-mono text-fg">{file.path}</span>
        <span>{stat(file.additions, file.deletions)}</span>
        {/* 只在文件夹里选中，不交给系统默认程序打开：Agent 改的可能是 .bat / .exe，打开就执行了 */}
        <Button variant="link" onClick={() => void kits.app.revealPath(full)}>
          {t('changes.reveal')}
        </Button>
      </div>
      {pending || !lines.length ? (
        <p className="m-0 px-3 py-4 text-[0.923rem] text-fg-muted">
          {pending ? t('changes.pendingDiff') : t('changes.binary')}
        </p>
      ) : view === 'unified' ? (
        // 行比面板宽时横向滚动，底色要铺满整行
        <div className="w-max min-w-full pb-4 font-mono text-[0.885rem] leading-[1.75]">
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
        <div className="pb-4 font-mono text-[0.885rem] leading-[1.75]">
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

// ---------- 命令 ----------

function TerminalPanel({ commands, rules }: { commands: Command[]; rules: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2" data-testid="terminal">
      {commands.length ? (
        commands.map((c) => <CommandCard key={c.id} command={c} />)
      ) : (
        <Empty
          icon={<SquareTerminal size={22} className="text-fg-subtle" strokeWidth={1.4} />}
          title={t('terminal.empty')}
          note={t('terminal.emptyNote')}
        />
      )}
      <div className="mx-1.5 mt-2 flex flex-col gap-1.5 text-[0.923rem] text-fg-label">
        <span>{t('terminal.rules')}</span>
        {rules.length ? (
          <span className="flex flex-wrap gap-1.5">
            {rules.map((r) => (
              <span key={r} className="rounded-[4px] bg-hover px-[5px] font-mono text-fg">
                {r}
              </span>
            ))}
          </span>
        ) : (
          <span>{t('terminal.noRules')}</span>
        )}
      </div>
    </div>
  )
}

// 命令耗时：10 秒内带一位小数（0.9 秒、1.2 秒），和原型一致
function commandTime(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} 秒` : formatDuration(ms)
}

function CommandCard({ command: c }: { command: Command }) {
  const status =
    c.state === 'waiting'
      ? t('terminal.waiting')
      : c.state === 'interrupted'
        ? t('terminal.interrupted')
        : c.state === 'running'
          ? t('terminal.running')
          : c.exitCode !== undefined
            ? t('terminal.exit', { code: c.exitCode })
            : c.state === 'failed'
              ? t('terminal.failed')
              : t('terminal.done')
  const meta = [c.durationMs !== undefined ? commandTime(c.durationMs) : null, c.how]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      data-testid="command"
      className={cx(
        'flex shrink-0 flex-col overflow-hidden rounded-[10px] border',
        c.state === 'waiting' ? 'border-warn-icon bg-warn-soft' : 'border-line-soft bg-raised',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-[0.923rem]">
        <span className="min-w-0 flex-1 truncate font-mono" title={c.command}>
          {c.command}
        </span>
        {c.state === 'running' ? <Spinner tone="muted" size={11} /> : null}
        <span
          className={cx(
            'shrink-0 font-medium',
            c.state === 'waiting' || c.state === 'running'
              ? 'text-warn'
              : c.state === 'failed' || c.state === 'interrupted'
                ? 'text-danger'
                : 'text-ok',
          )}
        >
          {status}
        </span>
        {meta ? <span className="shrink-0 text-fg-subtle">{meta}</span> : null}
      </div>
      {c.output ? (
        <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all border-line-soft border-t px-3 py-2.5 font-mono text-[0.885rem] text-fg-muted leading-[1.6]">
          {c.output}
        </pre>
      ) : null}
    </div>
  )
}

// ---------- 上下文 ----------

function ContextPanel({ detail, usage, contextWindow }: WorkbenchProps) {
  const homeLabel = useHomeLabel()
  const { session } = detail
  const [compactError, setCompactError] = useState<string>()
  const [compacting, setCompacting] = useState(false)
  const busy = compacting || session.status === 'running' || session.status === 'waiting'
  // 这个会话会读到的记忆条数（项目 + 个人）
  const memory = useQuery({
    queryKey: ['memory', 'count', session.workdir],
    queryFn: async () => {
      const [project, personal] = await Promise.all([
        kits.memory.list({ scope: 'project', workdir: session.workdir }),
        kits.memory.list({ scope: 'personal' }),
      ])
      return { project: project.entries.length, personal: personal.entries.length }
    },
  })
  const compact = async () => {
    setCompacting(true)
    setCompactError(undefined)
    try {
      await kits.session.compact(session.id)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setCompactError(m.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setCompacting(false)
    }
  }
  const pct = contextWindow ? Math.min(100, (usage.context / contextWindow) * 100) : 0
  const near = pct >= 85
  // input 已经含缓存读写
  const cachePct = usage.input ? Math.round((usage.cacheRead / usage.input) * 100) : 0
  const model = session.model.slice(session.model.indexOf('/') + 1)
  const rows: [string, string][] = [
    [t('context.agent'), session.agent],
    [
      t('context.kernel'),
      [
        session.kernel === 'opencode' ? 'OpenCode' : 'CodeAgent',
        model,
        contextWindow ? t('context.window', { n: formatTokens(contextWindow) }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [t('context.workdir'), homeLabel(session.workdir)],
  ]
  if (memory.data) {
    rows.push([
      t('context.memory'),
      t('context.memoryValue', { project: memory.data.project, personal: memory.data.personal }),
    ])
  }
  if (usage.input || usage.output) {
    rows.push([
      t('context.tokens'),
      [
        t('context.tokensValue', {
          input: formatTokens(usage.input),
          output: formatTokens(usage.output),
        }),
        usage.cacheRead ? t('context.cache', { pct: cachePct }) : null,
        usage.cost ? `约 ¥${usage.cost.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ])
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-1.5 pb-4"
      data-testid="context"
    >
      <div className="flex flex-col gap-2 border-line-soft border-b py-3">
        <div className="flex items-baseline text-[0.923rem]">
          <span className="flex-1 text-fg-muted">{t('context.usage')}</span>
          <span className="font-medium font-mono" data-testid="context-usage">
            {usage.context
              ? `${formatTokens(usage.context)}${contextWindow ? ` / ${formatTokens(contextWindow)}` : ''}`
              : t('context.unknown')}
          </span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 原生 meter 的样式各平台不一样，按原型自绘 */}
        <div
          role="meter"
          aria-label={t('context.usage')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="flex h-2 overflow-hidden rounded-[4px] bg-hover"
        >
          <div
            className={cx('h-full transition-[width]', near ? 'bg-warn' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[0.923rem] text-fg-muted leading-[1.6]">{t('context.note')}</div>
        {session.turns > 0 ? (
          <div className="flex items-start gap-2.5 pt-1">
            <span className="min-w-0 flex-1 text-[0.885rem] text-fg-label leading-[1.6]">
              {compactError ? (
                <span role="alert" className="text-danger">
                  {compactError}
                </span>
              ) : (
                t('context.compactHint')
              )}
            </span>
            <Button className="h-[26px] px-2" disabled={busy} onClick={() => void compact()}>
              {t('context.compact')}
            </Button>
          </div>
        ) : null}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 border-line-soft border-b py-2.5">
          <span className="shrink-0 basis-[60px] text-[0.923rem] text-fg-muted">{k}</span>
          <span className="min-w-0 flex-1 whitespace-pre-line break-all font-mono text-[0.923rem]">
            {v}
          </span>
        </div>
      ))}
    </div>
  )
}
