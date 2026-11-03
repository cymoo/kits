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
  // 要填进首页输入框的话（首页建议、⌘K 的“新会话：…”）；n 每次递增，同一句话点两次也会再填
  homeDraft: { text: string; n: number } | undefined
  toggleNav(): void
  setNavCollapsed(collapsed: boolean): void
  setPaletteOpen(open: boolean): void
  setPanel(mode: PanelMode): void
  fillHome(text: string): void
}

export const useUi = create<UiState>((set, get) => ({
  navCollapsed: readCollapsed(),
  paletteOpen: false,
  panel: readPanel(),
  homeDraft: undefined,
  fillHome(text) {
    set({ homeDraft: { text, n: (get().homeDraft?.n ?? 0) + 1 } })
  },
  setPanel(mode) {
    try {
      localStorage.setItem(PANEL_KEY, mode)
    } catch {
      // 存不了就只在本次生效
    }
    set({ panel: mode })
  },
  setNavCollapsed(collapsed) {
    try {
      localStorage.setItem(NAV_KEY, collapsed ? '1' : '0')
    } catch {
      // 存不了就只在本次生效
    }
    set({ navCollapsed: collapsed })
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
