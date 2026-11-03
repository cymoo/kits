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

// 模型引用指向启用的网关下还在的模型
function modelUsable(ref: string | undefined, settings: Settings): ref is string {
  if (!ref) return false
  const i = ref.indexOf('/')
  if (i <= 0) return false
  const gateway = settings.gateways.find((g) => g.id === ref.slice(0, i) && g.enabled)
  return !!gateway?.models.some((m) => m.id === ref.slice(i + 1))
}

// 选过的模型所在网关删了或停用了：回退到默认模型；默认模型也不能用就空着，发送按钮置灰
function resolveModel(picked: string | undefined, settings: Settings | undefined): string {
  if (!settings) return picked ?? ''
  if (modelUsable(picked, settings)) return picked
  return modelUsable(settings.defaultModel, settings) ? settings.defaultModel : ''
}

// 用户没选过的项按设置补上
export function resolvePrefs(prefs: ComposerPrefs, settings: Settings | undefined) {
  return {
    workdir: prefs.workdir ?? settings?.workdirs[0]?.path,
    agent: prefs.agent,
    permissionMode: prefs.permissionMode ?? settings?.permissionMode ?? 'ask',
    kernel: prefs.kernel ?? settings?.kernel ?? 'opencode',
    model: resolveModel(prefs.model, settings),
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
