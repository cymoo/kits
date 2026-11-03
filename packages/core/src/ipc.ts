import type { GeneralSettings, Settings } from './config/settings'
import type {
  AgentSummary,
  CreateSessionInput,
  FileDiffView,
  MessageView,
  OutputView,
  PartView,
  SessionActivity,
  SessionDetail,
  SessionSummary,
} from './session'

// 渲染进程的 tsconfig 不带 Node 类型，不能引 @kits/core 的入口（里面有 node:fs），要用的类型从这里转出去
export type { Gateway, GatewayModel } from './config/gateway'
export type { PermissionLevel, PermissionMode } from './config/permission'
export type { GeneralSettings, Settings } from './config/settings'
export type * from './session'

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
  // 家目录，界面上把路径缩写成 ~/…
  homeDir: string
}

export type GatewayTestResult =
  | { ok: true; latencyMs: number; models: string[] }
  | { ok: false; latencyMs: number; error: string }

export interface GatewayTestInput {
  baseUrl: string
  // 不传就用已保存的 `gateway:<gatewayId>` 密钥（设置页里改地址后重测，不用重填 key）
  apiKey?: string
  gatewayId?: string
}

export type KernelName = 'opencode' | 'codeagent'

// 内核进程的运行状态（KernelManager 维护）
export interface KernelRuntime {
  id: KernelName
  state: 'stopped' | 'starting' | 'running' | 'error' | 'restart-pending'
  error: string | null
  // 配置不全时指向设置分区的问题（section: model / mcp / agent）
  problems: { section: string; target: string; message: string }[]
}

export interface KernelInfo extends KernelRuntime {
  installed: boolean
  // `<binary> --version` 的输出，取不到为 null
  version: string | null
  binary: string | null
  logsDir: string
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
    // 在访达 / 资源管理器里选中这个文件（不打开它）
    revealPath: method<string, void>(),
  },
  settings: {
    get: method<undefined, Settings>(),
    update: method<SettingsPatch, Settings>(),
    // settings.json 读不了时的原因（界面提示用），正常为 null
    loadError: method<undefined, string | null>(),
  },
  gateway: {
    test: method<GatewayTestInput, GatewayTestResult>(),
  },
  kernel: {
    status: method<undefined, KernelInfo[]>(),
    openLogs: method<KernelName, void>(),
    restart: method<KernelName, void>(),
  },
  session: {
    create: method<CreateSessionInput, SessionSummary>(),
    list: method<undefined, SessionSummary[]>(),
    get: method<string, SessionDetail | null>(),
    prompt: method<{ id: string; text: string }, void>(),
    abort: method<string, void>(),
    respondPermission: method<
      { id: string; requestId: string; reply: 'once' | 'always' | 'reject'; message?: string },
      void
    >(),
    answerQuestion: method<{ id: string; questionId: string; answer: string }, void>(),
    // 这个会话每轮改了的文件
    diffs: method<string, FileDiffView[]>(),
  },
  output: {
    // 这个会话每轮的产出
    list: method<string, OutputView[]>(),
    // 自动保存人工修改；null 表示还原为 AI 原稿
    save: method<{ id: string; edited: unknown | null }, OutputView>(),
    // 写到 {userData}/exports/，返回文件路径
    export: method<{ id: string; format: 'markdown' | 'json' }, { path: string }>(),
  },
  workdir: {
    // 弹系统的目录选择框，取消时返回 null；选中的目录记进最近使用
    pick: method<undefined, string | null>(),
  },
  agents: {
    list: method<undefined, AgentSummary[]>(),
  },
  secrets: {
    set: method<{ key: string; value: string }, void>(),
    has: method<string, boolean>(),
    remove: method<string, void>(),
    // 系统钥匙串能不能用；不能用时密钥以明文（base64）存在 secrets.json，界面要说清楚
    encrypted: method<undefined, boolean>(),
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
  'kernel.status': KernelRuntime
  // 会话的元数据变了（状态、标题、轮次）
  'session.changed': SessionSummary
  'session.message': MessageView
  'session.part': PartView
  'session.activity': SessionActivity
  // 一轮结束后内核算出了新的改动
  'session.diffs': { sessionId: string; files: FileDiffView[] }
  // 一轮的产出有了（回复正文、submit_output）或者被改了
  'session.output': OutputView
}
export type PushChannel = keyof PushEvents
export const pushChannels: PushChannel[] = [
  'settings.changed',
  'kernel.status',
  'session.changed',
  'session.message',
  'session.part',
  'session.activity',
  'session.diffs',
  'session.output',
]

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
