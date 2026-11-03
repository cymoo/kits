import { useEffect, useRef } from 'react'

// 快捷键集中在这里注册（phase1-implementation 6.5 节）。mac 用 ⌘，Windows / Linux 用 Ctrl。
// 通用设置页只展示这张表，不能改。

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
export const modLabel = isMac ? '⌘' : 'Ctrl+'

export type ShortcutId = 'newSession' | 'search' | 'settings' | 'stop' | 'toggleNav' | 'widePanel'

export const shortcuts: Record<ShortcutId, { key: string; label: string }> = {
  newSession: { key: 'n', label: `${modLabel}N` },
  search: { key: 'k', label: `${modLabel}K` },
  settings: { key: ',', label: `${modLabel},` },
  stop: { key: '.', label: `${modLabel}.` },
  toggleNav: { key: 'b', label: `${modLabel}B` },
  // 会话页：放大 / 缩回右侧工作区面板
  widePanel: { key: '\\', label: `${modLabel}\\` },
}

export function matchShortcut(e: KeyboardEvent, id: ShortcutId, mac = isMac): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  return mod && !e.altKey && e.key.toLowerCase() === shortcuts[id].key
}

// 注册一组全局快捷键，handlers 用 ref 存，组件重渲染不用重新绑
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const id of Object.keys(ref.current) as ShortcutId[]) {
        if (matchShortcut(e, id)) {
          e.preventDefault()
          ref.current[id]?.()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
