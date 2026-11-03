import type { PermissionMode, Settings } from '@kits/core/ipc'
import { create } from 'zustand'

// 输入框上的选择（目录、Agent、权限、内核、模型）。默认取设置里的值，改了只影响之后新建的会话，不写回设置。

export interface ComposerPrefs {
  workdir: string | undefined
  agent: string
  permissionMode: PermissionMode | undefined
  kernel: Settings['kernel'] | undefined
  model: string | undefined
}

interface PrefsState extends ComposerPrefs {
  set(patch: Partial<ComposerPrefs>): void
}

export const usePrefs = create<PrefsState>((set) => ({
  workdir: undefined,
  agent: 'assistant',
  permissionMode: undefined,
  kernel: undefined,
  model: undefined,
  set: (patch) => set(patch),
}))

// 用户没选过的项按设置补上
export function resolvePrefs(prefs: ComposerPrefs, settings: Settings | undefined) {
  return {
    workdir: prefs.workdir ?? settings?.workdirs[0]?.path,
    agent: prefs.agent,
    permissionMode: prefs.permissionMode ?? settings?.permissionMode ?? 'ask',
    kernel: prefs.kernel ?? settings?.kernel ?? 'opencode',
    model: prefs.model ?? settings?.defaultModel ?? '',
  }
}

export function basename(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || p
  )
}
