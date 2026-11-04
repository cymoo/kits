// 能拖动改宽度的三栏：左侧栏、会话页右侧面板、面板放大时左边的对话栏。纯函数，有单测。
// 这里的上下限是拖动的范围；窗口太窄时各栏再用 CSS 的 max-width 让位，记住的宽度不变。

export const WIDTH_LIMITS = {
  nav: { min: 200, max: 360, initial: 248 },
  panel: { min: 300, max: 720, initial: 380 },
  chat: { min: 320, max: 640, initial: 400 },
} as const

export type WidthId = keyof typeof WIDTH_LIMITS
export type Widths = Record<WidthId, number>

export const initialWidths: Widths = {
  nav: WIDTH_LIMITS.nav.initial,
  panel: WIDTH_LIMITS.panel.initial,
  chat: WIDTH_LIMITS.chat.initial,
}

export function clampWidth(id: WidthId, width: number): number {
  const { min, max } = WIDTH_LIMITS[id]
  return Math.round(Math.min(max, Math.max(min, width)))
}

// 读 localStorage 里存的宽度：坏数据、缺的项都回到默认值
export function parseWidths(raw: string | null): Widths {
  let saved: Partial<Record<WidthId, unknown>> = {}
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (value && typeof value === 'object') saved = value
  } catch {
    // 存坏了就当没存过
  }
  const pick = (id: WidthId) => {
    const v = saved[id]
    return typeof v === 'number' && Number.isFinite(v) ? clampWidth(id, v) : initialWidths[id]
  }
  return { nav: pick('nav'), panel: pick('panel'), chat: pick('chat') }
}
