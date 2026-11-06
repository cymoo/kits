import type { AgentDraft, AgentOverview, AgentRef, AgentSaveInput, AgentView } from './agent-view'
import type { PermissionLevel, PermissionMode } from './config/permission'
import type { GeneralSettings, Settings } from './config/settings'
import type { McpOverview, McpParseResult, McpTestResult } from './mcp-view'
import type { MemoryOverview, MemoryScopeView } from './memory-view'
import type {
  AgentSummary,
  AttachmentInput,
  AttachmentView,
  CreateSessionInput,
  FileDiffView,
  FileEntry,
  FilePreview,
  MessageView,
  OutputView,
  PartView,
  QueuedDraft,
  SessionActivity,
  SessionDetail,
  SessionSearchHit,
  SessionSummary,
  WorkdirInspection,
} from './session'
import type { SkillOverview, SkillSource } from './skill-view'

export type * from './agent-view'
// 渲染进程的 tsconfig 不带 Node 类型，不能引 @kits/core 的入口（里面有 node:fs），要用的类型从这里转出去
export type { Gateway, GatewayModel } from './config/gateway'
export type { PermissionLevel, PermissionMode, PermissionRisk } from './config/permission'
export type { GeneralSettings, Settings } from './config/settings'
export type * from './mcp-view'
export type * from './memory-view'
export type * from './session'
export type * from './skill-view'
export { workdirKey } from './workdir'

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
  // KITS_SKIP_ONBOARDING=1：不进首次引导（E2E 用）
  skipOnboarding: boolean
  userDataDir: string
  // 家目录，界面上把路径缩写成 ~/…
  homeDir: string
  // 没选工作目录时用的默认目录（~/kits-workspace，可被 KITS_WORKSPACE_DIR 覆盖），用到才创建
  defaultWorkdir: string
}

export type GatewayTestResult =
  // contextWindows：网关报了上下文窗口的模型，没报的不在里面
  | { ok: true; latencyMs: number; models: string[]; contextWindows: Record<string, number> }
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
    // 检查更新（设置 · 通用的“版本与更新”）；没配更新地址或开发时返回 disabled
    checkForUpdates: method<
      undefined,
      | { status: 'disabled'; reason: 'dev' | 'no-url' }
      | { status: 'latest'; version: string }
      | { status: 'available'; version: string }
      | { status: 'error'; message: string }
    >(),
    // 设置 · 权限页的说明：默认权限（每次确认模式下）和只读命令白名单
    permissionDefaults: method<
      undefined,
      { tools: Record<string, PermissionLevel>; readonlyCommands: string[] }
    >(),
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
    // 标题和正文全文搜索，最多 20 条
    search: method<string, SessionSearchHit[]>(),
    // 删会话：记录、附件都删掉；还在跑的要先停止
    remove: method<string, void>(),
    // 改标题，不算会话有更新；改完经 session.changed 推回来
    rename: method<{ id: string; title: string }, void>(),
    // 置顶或取消置顶，不算会话有更新；改完经 session.changed 推回来
    setPinned: method<{ id: string; pinned: boolean }, void>(),
    // 改权限：立即生效，这一轮里下一次工具调用起按新权限；内核拒绝时抛错，权限不变
    setPermissionMode: method<{ id: string; mode: PermissionMode }, void>(),
    // 改模型：这一轮不变，下一条消息起生效
    setModel: method<{ id: string; model: string }, void>(),
    // 导出整个会话：写到 {userData}/exports/，返回文件路径
    export: method<{ id: string; format: 'markdown' | 'json' }, { path: string }>(),
    // 手动压缩上下文：等内核压完；失败抛错
    compact: method<string, void>(),
    prompt: method<{ id: string; text: string; attachments?: AttachmentInput[] }, void>(),
    // 停止；排队的消息退回来，放回输入框
    abort: method<string, QueuedDraft | null>(),
    // 从排队里拿走一条：编辑时放回输入框，删除时丢掉返回值
    dequeue: method<{ id: string; queueId: string }, QueuedDraft | null>(),
    // 插话：有文字发这一条；有 queueId 发排队里的那一条；都没有发全部排队的
    interject: method<
      { id: string; queueId?: string; text?: string; attachments?: AttachmentInput[] },
      void
    >(),
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
    // 写到 {userData}/exports/，返回文件路径
    export: method<{ id: string; format: 'markdown' | 'json' }, { path: string }>(),
  },
  mcp: {
    overview: method<undefined, McpOverview>(),
    // 粘贴识别，不写文件
    parse: method<string, McpParseResult>(),
    // 把粘贴的服务写进 mcp.json，返回加上的服务名
    add: method<string, string[]>(),
    remove: method<string, void>(),
    setEnabled: method<{ name: string; enabled: boolean }, void>(),
    // level 为 null 回到默认
    setPermission: method<{ server: string; tool: string; level: PermissionLevel | null }, void>(),
    test: method<string, McpTestResult>(),
  },
  skills: {
    // 给了工作目录就把项目技能也列上
    list: method<{ workdir?: string }, SkillOverview>(),
    // 关掉的技能记在 settings.json 的 skillsDisabled 里
    setEnabled: method<{ name: string; enabled: boolean }, void>(),
    // 打开某个来源的技能目录（没有就先建）
    openDir: method<{ source: SkillSource; workdir?: string }, void>(),
  },
  memory: {
    list: method<{ scope: MemoryScopeView; workdir?: string }, MemoryOverview>(),
    add: method<{ scope: MemoryScopeView; workdir?: string; text: string }, void>(),
    update: method<
      { scope: MemoryScopeView; workdir?: string; index: number; text: string },
      void
    >(),
    remove: method<{ scope: MemoryScopeView; workdir?: string; index: number }, void>(),
    // 用系统默认程序打开记忆文件（没有就先建一个空的）
    open: method<{ scope: MemoryScopeView; workdir?: string }, void>(),
  },
  files: {
    // 输入框 @ 菜单：工作目录里按路径匹配的文件（相对路径），最多 30 个
    search: method<{ workdir: string; query: string }, string[]>(),
    // 文件面板：列一层目录，dir 是相对工作区的路径，空串是根目录
    list: method<{ workdir: string; dir: string }, FileEntry[]>(),
    // 文件面板：读文件，目标不在工作区里时抛错
    read: method<{ workdir: string; path: string }, FilePreview>(),
    // 用系统应用打开
    open: method<{ workdir: string; path: string }, void>(),
    // PDF 预览要的 CMap、标准字体和解码器，随 pdfjs-dist 发在主进程这边
    pdfAsset: method<
      { kind: 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'; filename: string },
      Uint8Array
    >(),
  },
  workdir: {
    // 弹系统的目录选择框，取消时返回 null；选中的目录记进最近使用
    pick: method<undefined, string | null>(),
    // 改侧栏显示的名字，不碰磁盘
    rename: method<{ path: string; label: string }, void>(),
    // 从列表移除，连同这个工作区下所有会话的记录和附件；磁盘上的目录不动。有会话在运行时抛错
    remove: method<{ path: string }, void>(),
    // 看一眼目录的 Git 状态（首次引导用）
    inspect: method<string, WorkdirInspection>(),
    // 创建默认工作目录并记进最近使用，返回它的路径
    createDefault: method<undefined, string>(),
  },
  agents: {
    // 输入框的 Agent 浮层：给了工作目录时含项目 Agent
    list: method<{ workdir?: string }, AgentSummary[]>(),
    // 设置页 #agent：完整内容、默认权限、读不了的文件
    overview: method<{ workdir?: string }, AgentOverview>(),
    // 写成 Markdown 文件；个人的改了内核按新配置重启，项目的下一条消息起生效
    save: method<AgentSaveInput, AgentView>(),
    // 移到废纸篓；内置的不能删
    remove: method<AgentRef, void>(),
    // “看转换结果”：这份草稿转成内核配置是什么样（JSON 文本）
    preview: method<
      { source: AgentView['source']; workdir?: string; original?: string; draft: AgentDraft },
      string
    >(),
    // 新建 <name>.schema.json（一个起步的 JSON Schema）并写进 output
    createOutput: method<AgentRef, AgentView>(),
    // 用系统默认程序打开 Agent 文件或它的输出格式文件
    open: method<AgentRef & { what: 'file' | 'output' }, void>(),
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
  // 一条用户消息带的附件存好了
  'session.attachments': { sessionId: string; attachments: AttachmentView[] }
  // 点了系统通知：界面跳到这个路由（#/s/<id>）
  'app.navigate': string
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
  'session.attachments',
  'app.navigate',
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
