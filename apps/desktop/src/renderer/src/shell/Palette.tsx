import type { SessionSearchHit } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { History, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { type MessageKey, t } from '../app/i18n'
import { basename } from '../lib/composer-prefs'
import { kits } from '../lib/kits'
import { whenLabel } from '../lib/session-labels'
import { useSessions } from '../lib/sessions'
import { shortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { settingsSections } from '../pages/settings/sections'
import { cx } from '../ui/cx'
import { Dialog, DialogContent } from '../ui/Dialog'
import { Highlight } from '../ui/Highlight'
import { StatusDot } from './StatusDot'

// ⌘K 面板（原型 shell.js 的 .kk）：搜会话（标题 + 正文全文，命中处高亮）、动作（新会话、全部会话、设置分区）。
// 没输入时列最近的会话。↑↓ 选择，↵ 打开，Esc 关闭。

// 输入停一下再搜，不是每个字都查一次库
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return v
}

interface Action {
  id: string
  label: string
  icon: ReactNode
  kbd?: string
  keywords: string
  run(): void
}

export function Palette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // 不管从哪关的（执行动作、Esc、再按 ⌘K），下次打开都从空查询开始
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  const fillHome = useUi((s) => s.fillHome)

  const typed = query.trim()
  const searched = useDebounced(typed, 120)
  const recent = useSessions()
  const found = useQuery({
    queryKey: ['session-search', searched],
    queryFn: () => kits.session.search(searched),
    enabled: open && searched !== '',
    placeholderData: (prev) => prev,
  })
  // 没输入：最近 5 个会话；输入了：搜索结果（新结果回来之前先留着上一次的）
  const hits: SessionSearchHit[] = typed
    ? (found.data ?? []).slice(0, 6)
    : (recent.data ?? [])
        .slice(0, 5)
        .map((session) => ({ session, title: session.title, snippet: null }))
  const actions: Action[] = [
    {
      id: 'new',
      label: typed ? t('palette.newWith', { q: typed }) : t('palette.new'),
      icon: <Plus size={14} />,
      kbd: shortcuts.newSession.label,
      keywords: '新会话 new',
      run: () => {
        if (typed) fillHome(typed)
        go('/')
      },
    },
    {
      id: 'history',
      label: t('palette.history'),
      icon: <History size={14} />,
      keywords: '全部会话 历史 history',
      run: () => go('/history'),
    },
    ...settingsSections.map((s) => {
      const section = t(`settings.${s}` as MessageKey)
      return {
        id: `settings-${s}`,
        label: t('palette.settings', { section }),
        icon: <SlidersHorizontal size={14} />,
        keywords: `设置 settings ${section} ${s}`,
        run: () => go(`/settings/${s}`),
      }
    }),
  ]

  const q = query.trim().toLowerCase()
  // “新会话”一直在：没有匹配时也能把输入当作任务
  const shown = actions.filter(
    (a) => a.id === 'new' || !q || `${a.label} ${a.keywords}`.toLowerCase().includes(q),
  )

  // 会话在前、动作在后，方向键在两组之间连着走
  const total = hits.length + shown.length
  const runAt = (i: number) =>
    i < hits.length ? go(`/s/${hits[i]?.session.id}`) : shown[i - hits.length]?.run()
  const optionId = (i: number) =>
    i < hits.length ? `palette-s-${hits[i]?.session.id}` : `palette-${shown[i - hits.length]?.id}`

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      runAt(active)
    }
  }
  // 结果变少时选中项别落到列表外面
  useEffect(() => {
    if (active > total - 1) setActive(Math.max(total - 1, 0))
  }, [active, total])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent align="top" label={t('palette.label')}>
        <div className="flex h-[52px] items-center gap-2.5 border-line-soft border-b px-4">
          <Search size={16} className="text-fg-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={total ? optionId(active) : undefined}
            aria-label={t('nav.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            className="flex-1 border-0 bg-transparent text-[1.154rem] text-fg outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-6 cursor-pointer rounded-[6px] border border-line bg-raised px-2 text-[0.846rem] text-fg-muted"
          >
            {t('common.esc')}
          </button>
        </div>
        <div
          className="flex max-h-[440px] flex-col gap-px overflow-y-auto p-1.5"
          id="palette-list"
          role="listbox"
          aria-label={t('palette.label')}
        >
          <div className="px-2.5 pt-1.5 pb-1 font-medium text-[0.885rem] text-fg-label">
            {typed
              ? t('palette.sessionsFound', { n: found.data?.length ?? 0 })
              : t('palette.sessions')}
          </div>
          {hits.length === 0 ? (
            <p className="m-0 px-2.5 py-2 text-fg-muted">
              {typed
                ? found.isFetched
                  ? t('palette.noSessionMatch', { q: typed })
                  : '…'
                : t('palette.noSessions')}
            </p>
          ) : null}
          {hits.map((h, i) => (
            <button
              key={h.session.id}
              id={`palette-s-${h.session.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onPointerMove={() => setActive(i)}
              ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onClick={() => runAt(i)}
              className={cx(
                'flex min-h-11 w-full scroll-my-1.5 cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-1.5 text-left',
                i === active && 'bg-accent-bg',
              )}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <StatusDot status={h.session.status} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  <Highlight text={h.title} />
                </span>
                {h.snippet ? (
                  <span className="truncate text-[0.923rem] text-fg-muted">
                    <Highlight text={h.snippet} />
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[0.885rem] text-fg-label">
                {basename(h.session.workdir)} · {whenLabel(h.session.updatedAt)}
              </span>
            </button>
          ))}
          <div className="px-2.5 pt-1.5 pb-1 font-medium text-[0.885rem] text-fg-label">
            {t('palette.actions')}
          </div>
          {shown.map((a, j) => {
            const i = hits.length + j
            return (
              <button
                key={a.id}
                id={`palette-${a.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                // 鼠标真的移动了才跟着选；面板弹出来时正好在光标下面的那一项不算（mouseenter 会误选）
                onPointerMove={() => setActive(i)}
                // 方向键选到可视范围外的项时滚过去（焦点留在输入框）
                ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onClick={a.run}
                className={cx(
                  'flex min-h-9 w-full scroll-my-1.5 cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-[5px] text-left',
                  i === active && 'bg-accent-bg',
                )}
              >
                <span className="text-fg-muted">{a.icon}</span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.kbd ? (
                  <span className="font-mono text-[0.923rem] text-fg-label">{a.kbd}</span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 border-line-soft border-t px-4 py-2 text-[0.885rem] text-fg-label">
          <span>{t('palette.footSelect')}</span>
          <span>{t('palette.footOpen')}</span>
          <span className="flex-1" />
          <span>{t('palette.footLocal')}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
