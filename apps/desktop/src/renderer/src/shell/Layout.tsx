import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { t } from '../app/i18n'
import { useAppearance } from '../app/use-appearance'
import { kits, useAppInfo, useSettings, useSettingsSync } from '../lib/kits'
import { useSessionListSync, useSessions } from '../lib/sessions'
import { isMac, useShortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { useUpdateSync } from '../lib/update'
import { ResizeHandle } from '../ui/ResizeHandle'
import { Nav } from './Nav'
import { Palette } from './Palette'

// 启动后的跳转（首次引导、打开上次的会话）只在应用打开时做一次，之后回首页不再跳
let launched = false

// 应用外壳：侧栏 + 页面 + ⌘K 面板，注册全局快捷键，按设置应用外观。
export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const navCollapsed = useUi((s) => s.navCollapsed)
  const toggleNav = useUi((s) => s.toggleNav)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const panel = useUi((s) => s.panel)
  const settings = useSettings()
  useSettingsSync()
  useSessionListSync()
  useUpdateSync()

  useAppearance()
  const sessions = useSessions()
  const info = useAppInfo()

  // 设置页给分区导航让位（原型 settings.html），会话页放大工作区时给文件列表和 diff 让位（原型 ?panel=wide）：
  // 侧栏默认收成图标栏。这时按折叠按钮只在当前页展开，不改记住的状态，离开就还原。
  // “当前页”按范围算：设置各分区共用一个，会话一个会话一个
  const navScope = location.pathname.startsWith('/settings')
    ? 'settings'
    : location.pathname.startsWith('/s/') && panel === 'wide'
      ? location.pathname
      : undefined
  const autoCollapse = navScope !== undefined
  const [peekScope, setPeekScope] = useState<string>()
  // 比较放在渲染时，切页的第一帧就是收起的；effect 只负责清掉，回到原页不再展开
  const navPeek = autoCollapse && peekScope === navScope
  // biome-ignore lint/correctness/useExhaustiveDependencies: navScope 变了要清
  useEffect(() => setPeekScope(undefined), [navScope])
  const collapsed = autoCollapse ? !navPeek : navCollapsed
  const onToggleNav = autoCollapse ? () => setPeekScope(navPeek ? undefined : navScope) : toggleNav

  // 侧栏展开还是只留图标：设置里改了才跟着变（会一起记住）；启动时用上次记住的，⌘B 切过的也算
  const sidebar = settings.data?.general.sidebar
  const seenSidebar = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!sidebar) return
    if (seenSidebar.current && seenSidebar.current !== sidebar) {
      useUi.getState().setNavCollapsed(sidebar === 'icons')
    }
    seenSidebar.current = sidebar
  }, [sidebar])

  // 启动时只做一次：第一次用、还没配网关 → 首次引导；设置成“上次的会话” → 打开最近的会话
  useEffect(() => {
    if (launched || !settings.data || !sessions.isFetched || !info.data) return
    launched = true
    if (location.pathname !== '/') return
    const s = settings.data
    if (!s.onboardingDone && s.gateways.length === 0 && !info.data.skipOnboarding) {
      navigate('/onboarding', { replace: true })
      return
    }
    const last = sessions.data?.[0]
    if (s.general.startup === 'last' && last) navigate(`/s/${last.id}`, { replace: true })
  }, [settings.data, sessions.isFetched, sessions.data, info.data, location.pathname, navigate])

  // 点了系统通知：主进程叫窗口到前面，再让这里跳到那个会话
  useEffect(
    () =>
      kits.on('app.navigate', (to: string) => {
        setPaletteOpen(false)
        navigate(to)
      }),
    [navigate, setPaletteOpen],
  )

  useShortcuts({
    // 跳转前先关掉 ⌘K 面板，不然目标页面被面板挡着
    newSession: () => {
      setPaletteOpen(false)
      navigate('/')
    },
    search: () => setPaletteOpen(!paletteOpen),
    settings: () => {
      setPaletteOpen(false)
      navigate('/settings')
    },
    toggleNav: onToggleNav,
  })

  return (
    <div className="flex h-full overflow-hidden bg-bg text-fg">
      {/* macOS 隐藏了标题栏，顶部留一条可拖动窗口的区域 */}
      {isMac ? (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-10 h-7 [-webkit-app-region:drag]"
        />
      ) : null}
      <Nav collapsed={collapsed} onToggle={onToggleNav} />
      {collapsed ? null : <ResizeHandle id="nav" side="left" label={t('resize.nav')} />}
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <Palette />
    </div>
  )
}
