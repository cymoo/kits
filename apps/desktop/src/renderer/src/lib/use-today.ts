import { useEffect, useState } from 'react'

// 本地日期（按天分组用）。过了午夜、窗口回到前台时更新，空闲窗口跨天后分组也会挪
export function useToday(): string {
  const [today, setToday] = useState(() => new Date().toDateString())
  useEffect(() => {
    const refresh = () => setToday(new Date().toDateString())
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(
        () => {
          refresh()
          schedule()
        },
        midnight.getTime() - now.getTime() + 1_000,
      )
    }
    schedule()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return today
}
