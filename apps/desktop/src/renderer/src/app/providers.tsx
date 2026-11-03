import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TooltipProvider } from '../ui/Tooltip'

// 设置和列表的数据都在本机，不需要重试和窗口聚焦刷新
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
