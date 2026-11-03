import { create } from 'zustand'

// 界面状态（不进主进程的）：侧栏折叠、⌘K 面板开关、会话页右侧面板的大小。折叠和面板大小记在 localStorage，重开应用还在。

const NAV_KEY = 'kits.nav.collapsed'
const PANEL_KEY = 'kits.panel'

// 会话页右侧的工作区面板：side 窄栏（默认）、wide 放大（对话缩到左边 400px）、hidden 收起
export type PanelMode = 'side' | 'wide' | 'hidden'

function readPanel(): PanelMode {
  try {
    const v = localStorage.getItem(PANEL_KEY)
    return v === 'wide' || v === 'hidden' ? v : 'side'
  } catch {
    return 'side'
  }
}

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
  panel: PanelMode
  toggleNav(): void
  setPaletteOpen(open: boolean): void
  setPanel(mode: PanelMode): void
}

export const useUi = create<UiState>((set, get) => ({
  navCollapsed: readCollapsed(),
  paletteOpen: false,
  panel: readPanel(),
  setPanel(mode) {
    try {
      localStorage.setItem(PANEL_KEY, mode)
    } catch {
      // 存不了就只在本次生效
    }
    set({ panel: mode })
  },
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
