import { useEffect, useState } from 'react'

// 每隔一段时间刷新一次的当前时间（计时器、“运行中 · 0:46” 用）；enabled 为假时不跑
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs, enabled])
  return now
}

// 1:05、0:46、12 秒
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
