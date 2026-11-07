import type { Gateway, GatewayModel } from '@kits/core/ipc'

// 网关相关的纯逻辑，设置页和首次引导共用。

// 和 @kits/core 的 DEFAULT_CONTEXT_WINDOW 一样：渲染进程不能引 core 的入口
const DEFAULT_CONTEXT_WINDOW = 128_000

// 网关 id 进内核配置的 provider id、环境变量名和模型引用（`<网关 id>/<模型 id>`），
// 从地址的主机名里取一段，和已有的撞了加序号。用户不用自己起。
export function suggestGatewayId(baseUrl: string, taken: string[]): string {
  let base = 'gateway'
  try {
    const host = new URL(baseUrl).hostname
    const label = host.split('.').find((p) => !/^(llm|api|www|gw|gateway|\d+)$/i.test(p)) ?? host
    base =
      label
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'gateway'
    if (!/^[a-z0-9]/.test(base)) base = `gw-${base}`
  } catch {
    // 地址不对就用默认名
  }
  // 按环境变量名的规则比较（大写、- 和 _ 不分）：corp_2 和 corp-2 会撞到同一个 KITS_GW_CORP_2_KEY
  const envKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const takenKeys = new Set(taken.map(envKey))
  let id = base
  for (let i = 2; takenKeys.has(envKey(id)); i++) id = `${base}-${i}`
  return id
}

// 刷新模型列表：网关新列出来的加进来，已有的保留备注，网关不再列出的去掉。
// 上下文窗口：网关报了就用它的；已有模型只有还是默认值时才换，用户改过的不动。
// 图片输入：已有模型还没定过时才用网关报的，手动开关过的不动
export function mergeModels(
  current: GatewayModel[],
  listed: string[],
  windows: Record<string, number> = {},
  vision: Record<string, boolean> = {},
): GatewayModel[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  return listed.map((id) => {
    const reported = windows[id]
    const sees = vision[id]
    const m: GatewayModel = byId.get(id) ?? {
      id,
      note: '',
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      toolCall: true,
    }
    return {
      ...m,
      ...(reported && m.contextWindow === DEFAULT_CONTEXT_WINDOW
        ? { contextWindow: reported }
        : {}),
      ...(m.vision === undefined && sees !== undefined ? { vision: sees } : {}),
    }
  })
}

// 模型引用（`<网关 id>/<模型 id>`）对应的模型能不能看图片
export function supportsImages(gateways: Gateway[], ref: string): boolean {
  const slash = ref.indexOf('/')
  const gateway = gateways.find((g) => g.enabled && g.id === ref.slice(0, slash))
  return gateway?.models.find((m) => m.id === ref.slice(slash + 1))?.vision === true
}

// 第一个能看图片的模型，输入框里一键换过去用
export function firstImageModel(gateways: Gateway[]): string | undefined {
  for (const g of gateways) {
    if (!g.enabled) continue
    const m = g.models.find((x) => x.vision)
    if (m) return `${g.id}/${m.id}`
  }
  return undefined
}

export function newGateway(input: {
  id: string
  name: string
  baseUrl: string
  models: string[]
  contextWindows?: Record<string, number>
  vision?: Record<string, boolean>
}): Gateway {
  return {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    enabled: true,
    models: mergeModels([], input.models, input.contextWindows, input.vision),
  }
}

// 默认模型被删掉或所在网关被停用时，换成第一个可用的模型；没有就清空
export function fixDefaultModel(gateways: Gateway[], current: string): string {
  const usable = gateways
    .filter((g) => g.enabled)
    .flatMap((g) => g.models.map((m) => `${g.id}/${m.id}`))
  return usable.includes(current) ? current : (usable[0] ?? '')
}
