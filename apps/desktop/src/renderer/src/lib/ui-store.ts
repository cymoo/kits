import { create } from 'zustand'

// 界面状态（不进主进程的）：侧栏折叠、⌘K 面板开关。侧栏折叠记在 localStorage，重开应用还在。

const NAV_KEY = 'kits.nav.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === '1'
  } catch {
    return false
  }
}

interface UiState {
  navCollapsed: boolean
  paletteOpen: boolean
  toggleNav(): void
  setPaletteOpen(open: boolean): void
}

export const useUi = create<UiState>((set, get) => ({
  navCollapsed: readCollapsed(),
  paletteOpen: false,
  toggleNav() {
    const next = !get().navCollapsed
    try {
      localStorage.setItem(NAV_KEY, next ? '1' : '0')
    } catch {
      // 存不了就只在本次生效
    }
    set({ navCollapsed: next })
  },
  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },
}))
