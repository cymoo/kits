import { History, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { type MessageKey, t } from '../app/i18n'
import { shortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { settingsSections } from '../pages/settings/sections'
import { cx } from '../ui/cx'
import { Dialog, DialogContent } from '../ui/Dialog'

// ⌘K 面板（原型 shell.js 的 .kk）：搜会话、动作（新会话、全部会话、设置分区）。↑↓ 选择，↵ 打开，Esc 关闭。
// 会话搜索（标题 + 片段高亮）在 PR15 接 FTS，这里先只有动作。

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

  const typed = query.trim()
  const actions: Action[] = [
    {
      id: 'new',
      label: typed ? t('palette.newWith', { q: typed }) : t('palette.new'),
      icon: <Plus size={14} />,
      kbd: shortcuts.newSession.label,
      keywords: '新会话 new',
      run: () => go('/'),
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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      shown[active]?.run()
    }
  }

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
            aria-activedescendant={shown[active] ? `palette-${shown[active].id}` : undefined}
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
            {t('palette.sessions')}
          </div>
          <p className="px-2.5 py-2 text-fg-muted">{t('palette.noSessions')}</p>
          <div className="px-2.5 pt-1.5 pb-1 font-medium text-[0.885rem] text-fg-label">
            {t('palette.actions')}
          </div>
          {shown.map((a, i) => (
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
                'flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-[5px] text-left',
                i === active && 'bg-accent-bg',
              )}
            >
              <span className="text-fg-muted">{a.icon}</span>
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              {a.kbd ? (
                <span className="font-mono text-[0.923rem] text-fg-label">{a.kbd}</span>
              ) : null}
            </button>
          ))}
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
