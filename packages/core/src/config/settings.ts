import { z } from 'zod'
import { gatewaySchema } from './gateway'
import { permissionModeSchema } from './permission'

// ~/.kits/settings.json。字段都有默认值，旧文件缺字段、新装没有文件都能解析。

export const generalSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  // 对应 12 / 13 / 14px 基准
  uiScale: z.enum(['s', 'm', 'l']).default('m'),
  codeFontSize: z.number().int().min(10).max(20).default(13),
  // 空串用默认字体
  uiFont: z.string().default(''),
  codeFont: z.string().default(''),
  startup: z.enum(['last', 'new']).default('last'),
  sidebar: z.enum(['expanded', 'icons']).default('expanded'),
  notifyOnWait: z.boolean().default(true),
  notifyOnDone: z.boolean().default(false),
  keepRunning: z.boolean().default(true),
})
export type GeneralSettings = z.infer<typeof generalSettingsSchema>

export const kernelIdSchema = z.enum(['opencode', 'codeagent'])

export const workdirSchema = z.object({
  path: z.string().min(1),
  // 侧栏显示的名字，没有时用目录名；只是显示名，和磁盘无关
  label: z.string().optional(),
  lastUsedAt: z.number().default(0),
})

export const settingsSchema = z.object({
  version: z.literal(2).default(2),
  general: generalSettingsSchema.default(generalSettingsSchema.parse({})),
  // 新会话用的内核
  kernel: kernelIdSchema.default('opencode'),
  gateways: z.array(gatewaySchema).default([]),
  // `<网关 id>/<模型 id>`，空串表示还没选
  defaultModel: z.string().default(''),
  permissionMode: permissionModeSchema.default('smart'),
  workdirs: z.array(workdirSchema).default([]),
  // 技能默认全部启用，这里只记关闭的
  skillsDisabled: z.array(z.string()).default([]),
  // 内网更新地址，没配就不检查更新
  updateUrl: z.string().default(''),
  onboardingDone: z.boolean().default(false),
})
export type Settings = z.infer<typeof settingsSchema>

// 版本 1 的默认档是 ask，文件里分不清是不是用户选的，那时也没有“智能”可选：升级时一起换过去。
// 用户之后再选“每次确认”，存下的就是版本 2，不再改它
function migrate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input ?? {}
  const file = input as { version?: unknown; permissionMode?: unknown }
  if (file.version === 2) return input
  return {
    ...file,
    version: 2,
    permissionMode: file.permissionMode === 'ask' ? 'smart' : file.permissionMode,
  }
}

export function parseSettings(input: unknown): Settings {
  return settingsSchema.parse(migrate(input))
}

export const defaultSettings: Settings = parseSettings({})
