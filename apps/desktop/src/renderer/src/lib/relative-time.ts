// 侧栏行尾的相对时间：刚刚、12 分钟、1 小时、昨天、3 天，一个月以外写日期
export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  const midnight = (back: number) => {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
  }
  if (at >= midnight(0)) return `${Math.floor(minutes / 60)} 小时`
  if (at >= midnight(1)) return '昨天'
  const days = Math.round((midnight(0) - at) / 86_400_000)
  if (days <= 30) return `${days} 天`
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
