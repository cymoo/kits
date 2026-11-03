// 设置分区，路由 /settings/:section。perm 和 privacy 只放说明（phase1-implementation 6.3 节）。
export const settingsSections = [
  'general',
  'model',
  'mcp',
  'skills',
  'agent',
  'perm',
  'privacy',
] as const
export type SettingsSection = (typeof settingsSections)[number]

export function isSettingsSection(s: string | undefined): s is SettingsSection {
  return !!s && (settingsSections as readonly string[]).includes(s)
}
