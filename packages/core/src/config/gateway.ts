import { z } from 'zod'

// 模型网关：OpenAI 兼容接口。API Key 不在这里，存在 secrets 的 `gateway:<id>`。
// 模型 id 统一写成 `<网关 id>/<模型 id>`，内核配置里网关 id 就是 provider id。

export const DEFAULT_CONTEXT_WINDOW = 128_000

export const gatewayModelSchema = z.object({
  id: z.string().min(1),
  note: z.string().default(''),
  // 网关的模型列表带了就用它的（连接测试、刷新列表时取），没带默认 128K，设置页可改
  contextWindow: z.number().int().positive().default(DEFAULT_CONTEXT_WINDOW),
  toolCall: z.boolean().default(true),
  // 能不能看图片。网关的模型列表报了就用它的，设置页可改；没报也没改过是 undefined，当作不能看
  vision: z.boolean().optional(),
})
export type GatewayModel = z.infer<typeof gatewayModelSchema>

export const gatewaySchema = z.object({
  // 进内核配置的 provider id 和环境变量名，只允许小写字母、数字、- 和 _
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().default(''),
  // 允许先存空地址，生成内核配置时再报错指向设置项
  baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default(''),
  enabled: z.boolean().default(true),
  models: z.array(gatewayModelSchema).default([]),
})
export type Gateway = z.infer<typeof gatewaySchema>

export interface ModelRef {
  gateway: string
  model: string
}

// 模型 id 本身可能带 `/`（如 `deepseek/deepseek-v4`），只按第一个 `/` 拆
export function parseModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf('/')
  if (slash <= 0 || slash === ref.length - 1) return undefined
  return { gateway: ref.slice(0, slash), model: ref.slice(slash + 1) }
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.gateway}/${ref.model}`
}

export function findModel(
  gateways: Gateway[],
  ref: string,
): { gateway: Gateway; model: GatewayModel } | undefined {
  const parsed = parseModelRef(ref)
  if (!parsed) return undefined
  const gateway = gateways.find((g) => g.id === parsed.gateway && g.enabled)
  const model = gateway?.models.find((m) => m.id === parsed.model)
  return gateway && model ? { gateway, model } : undefined
}

export function gatewaySecretKey(id: string): string {
  return `gateway:${id}`
}
