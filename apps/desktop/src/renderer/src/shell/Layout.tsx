import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useAppearance } from '../app/use-appearance'
import { useAppInfo, useSettings, useSettingsSync } from '../lib/kits'
import { useSessionListSync, useSessions } from '../lib/sessions'
import { isMac, useShortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { Nav } from './Nav'
import { Palette } from './Palette'

// 启动后的跳转（首次引导、打开上次的会话）只在应用打开时做一次，之后回首页不再跳
let launched = false

// 应用外壳：侧栏 + 页面 + ⌘K 面板，注册全局快捷键，按设置应用外观。
export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleNav = useUi((s) => s.toggleNav)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const panel = useUi((s) => s.panel)
  const settings = useSettings()
  useSettingsSync()
  useSessionListSync()

  useAppearance()
  const sessions = useSessions()
  const info = useAppInfo()

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
    toggleNav,
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
      {/* 设置页的侧栏固定折叠成图标栏，给分区导航让位（原型 settings.html） */}
      <Nav
        forceCollapsed={
          location.pathname.startsWith('/settings') ||
          // 会话页放大工作区时侧栏也收成图标栏，窄窗口下文件列表和 diff 才放得下（原型 ?panel=wide）
          (location.pathname.startsWith('/s/') && panel === 'wide')
        }
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <Palette />
    </div>
  )
}
