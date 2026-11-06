import type { PermissionMode, Settings } from '@kits/core/ipc'
import { create } from 'zustand'

// 输入框上的选择（目录、Agent、权限、内核、模型）。默认取设置里的值，改了只影响之后新建的会话，不写回设置。

export interface ComposerPrefs {
  workdir: string | undefined
  agent: string
  permissionMode: PermissionMode | undefined
  kernel: Settings['kernel'] | undefined
  model: string | undefined
  // 这次不用的 MCP 服务
  mcpOff: string[]
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
  mcpOff: [],
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

// 优先级：手动选的 → Agent 配的 → 全局默认。指向的网关删了或停用了就往下退；都不能用就空着，发送按钮置灰
function resolveModel(
  picked: string | undefined,
  agentModel: string | undefined,
  settings: Settings | undefined,
): string {
  if (!settings) return picked ?? agentModel ?? ''
  for (const ref of [picked, agentModel, settings.defaultModel]) {
    if (modelUsable(ref, settings)) return ref
  }
  return ''
}

// 用户没选过的项按设置补上
export function resolvePrefs(
  prefs: ComposerPrefs,
  settings: Settings | undefined,
  // 选中的 Agent 配的模型
  agentModel?: string,
) {
  return {
    mcpOff: prefs.mcpOff,
    workdir: prefs.workdir ?? settings?.workdirs[0]?.path,
    agent: prefs.agent,
    permissionMode: prefs.permissionMode ?? settings?.permissionMode ?? 'smart',
    kernel: prefs.kernel ?? settings?.kernel ?? 'opencode',
    model: resolveModel(prefs.model, agentModel, settings),
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
