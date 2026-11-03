import type { AppInfo, Settings, SettingsPatch } from '@kits/core/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// 渲染进程只经 window.kits 和主进程说话（preload 按 core/ipc.ts 生成）。设置、列表走 TanStack Query。

export const kits = window.kits

export const queryKeys = {
  settings: ['settings'] as const,
  appInfo: ['app', 'info'] as const,
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => kits.settings.get() })
}

export function useUpdateSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => kits.settings.update(patch),
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.settings, settings)
      // 保存后坏文件已经备份，错误提示跟着消失
      void client.invalidateQueries({ queryKey: [...queryKeys.settings, 'loadError'] })
    },
  })
}

export function useSettingsLoadError() {
  return useQuery({
    queryKey: [...queryKeys.settings, 'loadError'],
    queryFn: () => kits.settings.loadError(),
  })
}

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => kits.app.info(),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

// 家目录下的路径写成 ~/…（和原型一致），完整路径放 title 里
export function useHomeLabel(): (dir: string) => string {
  const home = useAppInfo().data?.homeDir
  return (dir) => {
    if (!home) return dir
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir === home ? '~' : dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir
  }
}

// 主进程推来的设置变化（别的窗口改的、文件被重新读的）直接写进缓存
export function useSettingsSync() {
  const client = useQueryClient()
  useEffect(
    () =>
      kits.on('settings.changed', (s: Settings) => {
        client.setQueryData(queryKeys.settings, s)
        // 坏文件修好了（手改或保存）错误提示也要跟着变
        void client.invalidateQueries({ queryKey: [...queryKeys.settings, 'loadError'] })
      }),
    [client],
  )
}

export type { AppInfo }
