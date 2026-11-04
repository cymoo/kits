import type { SessionSummary } from '@kits/core/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronDown, Folder, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { type MessageKey, t } from '../../app/i18n'
import { basename } from '../../lib/composer-prefs'
import { kits, useHomeLabel } from '../../lib/kits'
import { type Group, groupSessions } from '../../lib/session-groups'
import {
  matchesFilter,
  type StatusFilter,
  stateOf,
  TONE,
  whenLabel,
} from '../../lib/session-labels'
import { sessionKeys, useSessions } from '../../lib/sessions'
import { useUi } from '../../lib/ui-store'
import { useNow } from '../../lib/use-now'
import { PinButton, StatusDot } from '../../shell/SessionList'
import { cx } from '../../ui/cx'
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '../../ui/Menu'

// 会话历史（原型 history.html）：状态筛选、目录和 Agent 筛选、按时间分组；行尾可以删除（点两下）。

const GROUP_LABEL: Record<Group, MessageKey> = {
  pinned: 'nav.pinned',
  today: 'nav.today',
  yesterday: 'nav.yesterday',
  week: 'nav.week',
  earlier: 'nav.earlier',
}

const FILTERS: StatusFilter[] = ['all', 'active', 'attention', 'done']

const pill =
  'inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[13px] border px-2.5 text-[0.923rem]'

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function subline(s: SessionSummary): string {
  if (s.status === 'error' && s.lastError) return s.lastError
  if (s.status === 'waiting') return t('history.waitingSub')
  return [t('history.turns', { n: s.turns }), s.agent].join(' · ')
}

export function HistoryPage() {
  const client = useQueryClient()
  const sessions = useSessions()
  const homeLabel = useHomeLabel()
  const openPalette = useUi((s) => s.setPaletteOpen)
  const now = useNow(60_000)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [dir, setDir] = useState('')
  const [agent, setAgent] = useState('')
  const [confirming, setConfirming] = useState<string>()
  const [error, setError] = useState<string>()

  const all = sessions.data ?? []
  const dirs = [...new Set(all.map((s) => s.workdir))]
  const agents = [...new Set(all.map((s) => s.agent))].sort()
  // biome-ignore lint/correctness/useExhaustiveDependencies: now 变了（跨过午夜）要重新分组
  const groups = useMemo(
    () =>
      groupSessions(
        all.filter(
          (s) =>
            matchesFilter(s, filter) &&
            (!dir || s.workdir === dir) &&
            (!agent || s.agent === agent),
        ),
      ),
    [all, filter, dir, agent, now],
  )

  const remove = async (id: string) => {
    setError(undefined)
    try {
      await kits.session.remove(id)
      client.setQueryData<SessionSummary[]>(sessionKeys.list, (list) =>
        (list ?? []).filter((s) => s.id !== id),
      )
    } catch (e) {
      setError(errorText(e))
    }
    setConfirming(undefined)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-10 py-8">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
            {t('history.heading')}
          </h1>
          <span className="text-[0.923rem] text-fg-muted">
            {t('history.count', { n: all.length })}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => openPalette(true)}
            className="inline-flex h-8 min-w-[240px] cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-raised px-3 text-left text-fg-muted hover:bg-active"
          >
            <Search size={14} />
            <span className="flex-1">{t('history.search')}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cx(
                pill,
                filter === f
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-line bg-raised text-fg hover:bg-active',
              )}
            >
              {t(`history.filter.${f}` as MessageKey)}
            </button>
          ))}
          <span className="mx-1 h-[18px] w-px bg-line" />
          <Menu>
            <MenuTrigger className={cx(pill, 'border-line bg-raised text-fg hover:bg-active')}>
              <Folder size={12} />
              {dir ? basename(dir) : t('history.allDirs')}
              <ChevronDown size={11} />
            </MenuTrigger>
            <MenuContent>
              <MenuRadioGroup value={dir} onValueChange={setDir}>
                <MenuRadioItem value="">{t('history.allDirs')}</MenuRadioItem>
                {dirs.map((d) => (
                  <MenuRadioItem key={d} value={d}>
                    <span className="font-mono text-[0.923rem]">{homeLabel(d)}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger className={cx(pill, 'border-line bg-raised text-fg hover:bg-active')}>
              <Bot size={12} />
              {agent || t('history.allAgents')}
              <ChevronDown size={11} />
            </MenuTrigger>
            <MenuContent>
              <MenuRadioGroup value={agent} onValueChange={setAgent}>
                <MenuRadioItem value="">{t('history.allAgents')}</MenuRadioItem>
                {agents.map((a) => (
                  <MenuRadioItem key={a} value={a}>
                    <span className="font-mono text-[0.923rem]">{a}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        </div>

        {error ? (
          <p role="alert" className="m-0 rounded-[10px] bg-danger-bg px-3.5 py-2 text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5" data-testid="history-list">
          {groups.map(([group, items]) => (
            <section key={group} className="flex flex-col gap-px">
              <h2 className="m-0 px-1.5 pt-2.5 pb-0.5 font-medium text-[0.885rem] text-fg-label">
                {t(GROUP_LABEL[group])}
              </h2>
              {items.map((s) => {
                const state = stateOf(s.status)
                const busy = s.status === 'running' || s.status === 'waiting'
                const asking = confirming === s.id
                return (
                  <div
                    key={s.id}
                    data-testid={`history-${s.id}`}
                    className="group relative rounded-[10px] hover:bg-raised hover:shadow-[0_0_0_1px_var(--k-border)]"
                  >
                    <Link
                      to={`/s/${s.id}`}
                      className="grid min-h-12 grid-cols-[16px_minmax(0,1fr)_140px_80px_144px] items-center gap-3 rounded-[10px] px-3 py-2 text-fg no-underline"
                    >
                      <span className="flex justify-center">
                        <StatusDot status={s.status} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="truncate font-medium">{s.title}</span>
                        <span className="truncate text-[0.923rem] text-fg-muted">{subline(s)}</span>
                      </span>
                      <span
                        className="truncate font-mono text-[0.923rem] text-fg-muted"
                        title={homeLabel(s.workdir)}
                      >
                        {basename(s.workdir)}
                      </span>
                      <span className={cx('font-medium text-[0.923rem]', TONE[state.tone])}>
                        {state.label}
                      </span>
                      <span className="pr-16 text-right text-[0.923rem] text-fg-label">
                        {whenLabel(s.updatedAt, now)}
                      </span>
                    </Link>
                    <PinButton session={s} className="right-9 h-7 w-7 rounded-[7px]" />
                    {busy ? null : (
                      <button
                        type="button"
                        aria-label={
                          asking
                            ? t('history.confirmRemove')
                            : t('history.remove', { title: s.title })
                        }
                        title={asking ? undefined : t('history.removeShort')}
                        onClick={() => (asking ? void remove(s.id) : setConfirming(s.id))}
                        onBlur={() => setConfirming((c) => (c === s.id ? undefined : c))}
                        className={cx(
                          'absolute top-1/2 right-2 flex h-7 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-[7px] px-1.5 text-fg-muted opacity-0 hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100',
                          asking && 'bg-danger-bg text-danger opacity-100',
                        )}
                      >
                        <Trash2 size={14} />
                        {asking ? (
                          <span className="text-[0.885rem]">{t('history.confirmRemove')}</span>
                        ) : null}
                      </button>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
          {sessions.isSuccess && groups.length === 0 ? (
            <div className="p-10 text-center text-fg-muted">
              {all.length === 0 ? t('history.empty') : t('history.noMatch')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
