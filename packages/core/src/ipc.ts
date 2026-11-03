import type { GeneralSettings, Settings } from './config/settings'

// 渲染进程的 tsconfig 不带 Node 类型，不能引 @kits/core 的入口（里面有 node:fs），要用的类型从这里转出去
export type { Gateway, GatewayModel } from './config/gateway'
export type { PermissionLevel, PermissionMode } from './config/permission'
export type { GeneralSettings, Settings } from './config/settings'

// IPC 契约（phase1-implementation 5.5 节）：一个对象字面量声明所有通道的入参和返回值。
// preload 按它生成 window.kits.<域>.<方法>，主进程 ipc/register.ts 按它逐个 handle，类型不一致编译就报错。
// 这个文件会被打进 sandbox 的 preload，只能有类型导入，不能引 Node 模块。

declare const IN: unique symbol
declare const OUT: unique symbol

// 只用来带类型的标记，运行时是空对象
export interface Method<I, O> {
  readonly [IN]?: I
  readonly [OUT]?: O
}
// 没有入参的方法 I 写 undefined
const method = <I = undefined, O = void>(): Method<I, O> => ({})

export interface AppInfo {
  version: string
  os: string
  electron: string
  node: string
  // 用户配置目录（~/.kits，可被 KITS_CONFIG_DIR 覆盖）和运行数据目录
  configDir: string
  // 给人看的写法：家目录换成 ~（~/.kits/）
  configDirLabel: string
  userDataDir: string
}

// 设置的局部更新：顶层字段整体替换，general 按字段合并
export type SettingsPatch = Partial<Omit<Settings, 'version' | 'general'>> & {
  general?: Partial<GeneralSettings>
}

export const ipcContract = {
  app: {
    info: method<undefined, AppInfo>(),
    openExternal: method<string, void>(),
    openPath: method<string, void>(),
  },
  settings: {
    get: method<undefined, Settings>(),
    update: method<SettingsPatch, Settings>(),
    // settings.json 读不了时的原因（界面提示用），正常为 null
    loadError: method<undefined, string | null>(),
  },
  secrets: {
    set: method<{ key: string; value: string }, void>(),
    has: method<string, boolean>(),
    remove: method<string, void>(),
  },
} as const

export type IpcContract = typeof ipcContract
export type IpcDomain = keyof IpcContract

type InOf<T> = T extends Method<infer I, unknown> ? I : never
type OutOf<T> = T extends Method<unknown, infer O> ? O : never

// 渲染进程看到的调用方式：没有入参的方法不用传参
export type KitsInvoke = {
  [D in IpcDomain]: {
    [M in keyof IpcContract[D]]: [InOf<IpcContract[D][M]>] extends [undefined]
      ? () => Promise<OutOf<IpcContract[D][M]>>
      : (input: InOf<IpcContract[D][M]>) => Promise<OutOf<IpcContract[D][M]>>
  }
}

// 主进程要实现的处理函数，少一个或类型不对编译报错
export type IpcHandlers = {
  [D in IpcDomain]: {
    [M in keyof IpcContract[D]]: (
      input: InOf<IpcContract[D][M]>,
    ) => Promise<OutOf<IpcContract[D][M]>> | OutOf<IpcContract[D][M]>
  }
}

// 主 → 渲染的推送
export interface PushEvents {
  'settings.changed': Settings
}
export type PushChannel = keyof PushEvents
export const pushChannels: PushChannel[] = ['settings.changed']

export function channelName(domain: string, method: string): string {
  return `${domain}.${method}`
}

// 按契约列出所有 [域, 方法]，preload 和主进程都用它遍历
export function contractEntries(): [IpcDomain, string][] {
  return (Object.keys(ipcContract) as IpcDomain[]).flatMap((d) =>
    Object.keys(ipcContract[d]).map((m): [IpcDomain, string] => [d, m]),
  )
}

export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const { general, ...rest } = patch
  return { ...settings, ...rest, general: { ...settings.general, ...general } }
}
