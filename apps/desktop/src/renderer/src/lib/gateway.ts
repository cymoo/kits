import type { Gateway, GatewayModel } from '@kits/core/ipc'

// 网关相关的纯逻辑，设置页和首次引导共用。

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
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`
  return id
}

// 刷新模型列表：网关新列出来的加进来，已有的保留备注和上下文窗口，网关不再列出的去掉
export function mergeModels(current: GatewayModel[], listed: string[]): GatewayModel[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  return listed.map(
    (id) => byId.get(id) ?? { id, note: '', contextWindow: 128_000, toolCall: true },
  )
}

export function newGateway(input: {
  id: string
  name: string
  baseUrl: string
  models: string[]
}): Gateway {
  return {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    enabled: true,
    models: mergeModels([], input.models),
  }
}

// 默认模型被删掉或所在网关被停用时，换成第一个可用的模型；没有就清空
export function fixDefaultModel(gateways: Gateway[], current: string): string {
  const usable = gateways
    .filter((g) => g.enabled)
    .flatMap((g) => g.models.map((m) => `${g.id}/${m.id}`))
  return usable.includes(current) ? current : (usable[0] ?? '')
}
