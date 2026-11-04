import type { KeyboardEvent, PointerEvent } from 'react'
import { useUi } from '../lib/ui-store'
import { WIDTH_LIMITS, type WidthId } from '../lib/widths'

// 栏之间的拖动手柄：拖动改宽度，双击恢复默认，获得焦点后方向键也能调。
// 自身宽度为 0，放在两栏之间的 flex 行里，不占位置；可点的部分左右各伸出 4px。
// side 说明被调整的那栏在手柄哪一边：left 时往右拖变宽，right 时往左拖变宽。

const KEY_STEP = 16

export function ResizeHandle({
  id,
  label,
  side,
}: {
  id: WidthId
  label: string
  side: 'left' | 'right'
}) {
  const width = useUi((s) => s.widths[id])
  const setWidth = useUi((s) => s.setWidth)
  const dir = side === 'left' ? 1 : -1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget
    const box = handle.parentElement
    const column = side === 'left' ? box?.previousElementSibling : box?.nextElementSibling
    if (!column) return
    e.preventDefault()
    handle.focus()
    handle.setPointerCapture(e.pointerId)
    // 从实际宽度算起：窗口窄时栏被 max-width 压着，比记住的宽度小
    const startWidth = column.getBoundingClientRect().width
    const startX = e.clientX
    const root = document.documentElement
    root.dataset.resizing = ''
    const onMove = (ev: globalThis.PointerEvent) =>
      setWidth(id, startWidth + dir * (ev.clientX - startX))
    const onEnd = () => {
      delete root.dataset.resizing
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setWidth(id, width + (e.key === 'ArrowRight' ? dir : -dir) * KEY_STEP)
  }

  return (
    <div className="relative z-20 w-0 shrink-0">
      {/* biome-ignore lint/a11y/useSemanticElements: 能拖动的分隔条，hr 不能获得焦点 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={WIDTH_LIMITS[id].min}
        aria-valuemax={WIDTH_LIMITS[id].max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setWidth(id, WIDTH_LIMITS[id].initial)}
        onKeyDown={onKeyDown}
        // macOS 顶部有一条全宽的拖动窗口层，手柄要浮在它上面、不参与拖动
        className="group absolute inset-y-0 -left-[4px] w-[8px] cursor-col-resize touch-none outline-none [-webkit-app-region:no-drag]"
      >
        <span className="absolute inset-y-0 left-[3px] w-[2px] transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent group-active:bg-accent" />
      </div>
    </div>
  )
}
