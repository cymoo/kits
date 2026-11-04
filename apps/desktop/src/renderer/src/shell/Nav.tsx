import { History, PanelLeft, Plus, Search, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { t } from '../app/i18n'
import { isMac, shortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { cx } from '../ui/cx'
import { Kbd } from '../ui/Kbd'
import { SessionList } from './SessionList'

// 侧栏（原型 shell.js 的 <k-nav>）：新会话、搜索、全部会话、按时间分组的会话列表、设置；⌘B 折叠成图标栏。

const item =
  'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-left text-fg no-underline hover:bg-hover'

function NavItem({
  to,
  icon,
  label,
  kbd,
  onClick,
  collapsed,
  active,
}: {
  to?: string
  icon: ReactNode
  label: string
  kbd?: string
  onClick?: () => void
  collapsed: boolean
  active?: boolean
}) {
  const body = (
    <>
      {icon}
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
      {collapsed || !kbd ? null : <Kbd>{kbd}</Kbd>}
    </>
  )
  const cls = (on: boolean) =>
    cx(item, on && 'bg-hover font-medium', collapsed && 'w-8 justify-center gap-0 px-0')
  const title = kbd ? `${label} ${kbd}` : label
  if (to) {
    return (
      // 只有首页要精确匹配；设置下的各分区（/settings/model）也算在“设置”里
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) => cls(active ?? isActive)}
        title={title}
      >
        {body}
      </NavLink>
    )
  }
  return (
    <button type="button" className={cls(!!active)} onClick={onClick} title={title}>
      {body}
    </button>
  )
}

export function Nav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const width = useUi((s) => s.widths.nav)
  const toggleLabel = t(collapsed ? 'nav.expand' : 'nav.collapse')
  return (
    <nav
      aria-label={t('nav.label')}
      data-collapsed={collapsed}
      style={collapsed ? undefined : { width }}
      className={cx(
        // 宽度动画期间文字不换行，展开 / 收起时不会挤成好几行
        'flex h-full min-w-0 shrink-0 flex-col gap-1.5 overflow-hidden whitespace-nowrap border-line border-r bg-muted px-2 pb-2 transition-[width] duration-150',
        collapsed ? 'w-14 items-center' : 'max-w-[40vw]',
        // macOS 隐藏了标题栏，左上角的红绿灯占了约 40px 高，内容从它下面开始
        isMac ? 'pt-11' : 'pt-3',
      )}
    >
      <div className={cx('flex h-8 items-center gap-2 px-2', collapsed && 'h-auto flex-col px-0')}>
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-primary font-bold text-[12px] text-primary-fg"
        >
          k
        </span>
        {collapsed ? null : (
          <span className="font-semibold text-[1.077rem] tracking-[-0.01em]">{t('app.name')}</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          title={`${toggleLabel} ${shortcuts.toggleNav.label}`}
          className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <PanelLeft size={14} />
        </button>
      </div>
      <div className={cx('flex flex-col gap-1', collapsed && 'items-center')}>
        <NavItem
          to="/"
          icon={<Plus size={15} />}
          label={t('nav.new')}
          kbd={shortcuts.newSession.label}
          collapsed={collapsed}
        />
        <NavItem
          icon={<Search size={15} />}
          label={t('nav.search')}
          kbd={shortcuts.search.label}
          onClick={() => setPaletteOpen(true)}
          collapsed={collapsed}
        />
        <NavItem
          to="/history"
          icon={<History size={15} />}
          label={t('nav.history')}
          collapsed={collapsed}
        />
      </div>
      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <div
          className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
          data-testid="session-list"
        >
          <SessionList />
        </div>
      )}
      <div
        className={cx(
          'flex flex-col gap-1 border-line border-t pt-1.5',
          collapsed && 'w-full items-center border-t-0',
        )}
      >
        <NavItem
          to="/settings"
          icon={<SlidersHorizontal size={15} />}
          label={t('nav.settings')}
          kbd={shortcuts.settings.label}
          collapsed={collapsed}
        />
      </div>
    </nav>
  )
}
