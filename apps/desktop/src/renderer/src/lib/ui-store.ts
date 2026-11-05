import { create } from 'zustand'
import { clampWidth, parseWidths, type WidthId, type Widths } from './widths'

// 界面状态（不进主进程的）：侧栏折叠、⌘K 面板开关、会话页右侧面板的大小、各栏宽度。除了 ⌘K 都记在 localStorage，重开应用还在。

const NAV_KEY = 'kits.nav.collapsed'
const PANEL_KEY = 'kits.panel'
const WIDTHS_KEY = 'kits.widths'
const EXPANDED_KEY = 'kits.nav.expanded'

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

function readExpanded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function readWidths(): Widths {
  try {
    return parseWidths(localStorage.getItem(WIDTHS_KEY))
  } catch {
    return parseWidths(null)
  }
}

interface UiState {
  navCollapsed: boolean
  // 侧栏里展开着的工作区（workdirKey），其余默认折叠
  expandedWorkspaces: string[]
  paletteOpen: boolean
  panel: PanelMode
  widths: Widths
  // 要填进首页输入框的话（首页建议、⌘K 的“新会话：…”）；n 每次递增，同一句话点两次也会再填
  homeDraft: { text: string; n: number } | undefined
  toggleNav(): void
  toggleWorkspace(key: string): void
  expandWorkspace(key: string): void
  setNavCollapsed(collapsed: boolean): void
  setPaletteOpen(open: boolean): void
  setPanel(mode: PanelMode): void
  setWidth(id: WidthId, width: number): void
  fillHome(text: string): void
}

function saveExpanded(list: string[], set: (patch: Partial<UiState>) => void): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(list))
  } catch {
    // 存不了就只在本次生效
  }
  set({ expandedWorkspaces: list })
}

export const useUi = create<UiState>((set, get) => ({
  navCollapsed: readCollapsed(),
  expandedWorkspaces: readExpanded(),
  paletteOpen: false,
  panel: readPanel(),
  widths: readWidths(),
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
  setWidth(id, width) {
    const widths = { ...get().widths, [id]: clampWidth(id, width) }
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths))
    } catch {
      // 存不了就只在本次生效
    }
    set({ widths })
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
  toggleWorkspace(key) {
    const list = get().expandedWorkspaces
    saveExpanded(list.includes(key) ? list.filter((k) => k !== key) : [...list, key], set)
  },
  expandWorkspace(key) {
    const list = get().expandedWorkspaces
    if (!list.includes(key)) saveExpanded([...list, key], set)
  },
  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },
}))
