import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { applyAppearance } from '../app/theme'
import { useSettings, useSettingsSync } from '../lib/kits'
import { useSessionListSync } from '../lib/sessions'
import { isMac, useShortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { Nav } from './Nav'
import { Palette } from './Palette'

// 应用外壳：侧栏 + 页面 + ⌘K 面板，注册全局快捷键，按设置应用外观。
export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleNav = useUi((s) => s.toggleNav)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const settings = useSettings()
  useSettingsSync()
  useSessionListSync()

  useEffect(() => {
    if (settings.data) return applyAppearance(settings.data.general)
  }, [settings.data])

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
      <Nav forceCollapsed={location.pathname.startsWith('/settings')} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <Palette />
    </div>
  )
}
