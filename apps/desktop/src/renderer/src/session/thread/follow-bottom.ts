import type { UIEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

// 对话跟随到底：新内容来了滚到底，用户往上翻了就不打扰，也不再跟随，直到回到底部或点“跳转至底部”。

type Metrics = Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>

export const nearBottom = (el: Metrics) => el.scrollHeight - el.scrollTop - el.clientHeight < 40

// 只有往上滚才算用户翻走了：内容变高也会离开底部，但这时 scrollTop 没变，要接着跟随
export function stillFollowing(following: boolean, el: Metrics, lastTop: number): boolean {
  if (nearBottom(el)) return true
  return el.scrollTop < lastTop ? false : following
}

export function useFollowBottom(id: string | undefined) {
  const scroller = useRef<HTMLElement | null>(null)
  const following = useRef(true)
  const lastTop = useRef(0)
  // 跳转按钮只在离开底部时出现
  const [atBottom, setAtBottom] = useState(true)

  const jump = useCallback(() => {
    following.current = true
    setAtBottom(true)
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // 换了会话就重新跟随到底
  // biome-ignore lint/correctness/useExhaustiveDependencies: id 变了才重置
  useEffect(jump, [id])

  // 流式回复、展开卡片、输入框变高都不触发 scroll，靠盯尺寸
  const ref = useCallback((el: HTMLElement | null) => {
    scroller.current = el
    if (!el) return
    const observer = new ResizeObserver(() => {
      // 窗口变高、内容变少也能回到底部，这时 scrollTop 没变，不会有 scroll 事件
      following.current = stillFollowing(following.current, el, el.scrollTop)
      if (following.current) el.scrollTop = el.scrollHeight
      setAtBottom(following.current)
    })
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      observer.disconnect()
      scroller.current = null
    }
  }, [])

  const onScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget
    following.current = stillFollowing(following.current, el, lastTop.current)
    lastTop.current = el.scrollTop
    setAtBottom(following.current || nearBottom(el))
  }, [])

  return { ref, onScroll, jump, atBottom }
}
