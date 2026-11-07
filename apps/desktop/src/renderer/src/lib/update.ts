import type { UpdateView } from '@kits/core/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { kits } from './kits'
import { useSessions } from './sessions'
import { busySessionCount } from './update-labels'

// 自动更新的状态：主进程查、下、装，界面只显示（侧栏底部的新版本标签、设置 · 通用的“版本与更新”）

export const updateKey = ['app', 'update'] as const

export function useUpdate() {
  return useQuery({ queryKey: updateKey, queryFn: () => kits.app.updateStatus() })
}

// 主进程推来的状态（开始查、下载进度、下载好、出错、地址变了）直接写进缓存
export function useUpdateSync() {
  const client = useQueryClient()
  useEffect(
    () => kits.on('app.update', (view: UpdateView) => client.setQueryData(updateKey, view)),
    [client],
  )
}

export function useCheckUpdate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => kits.app.checkForUpdates(),
    onSuccess: (view) => client.setQueryData(updateKey, view),
  })
}

export function useBusySessionCount(): number {
  return busySessionCount(useSessions().data)
}
