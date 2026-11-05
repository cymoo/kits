// 网关连接测试（phase1-implementation 3.1 节）：GET {baseUrl}/models 拿模型列表并量延迟。
// 不发对话请求、不计入用量。地址只认 http(s)，超时 10 s。
// OpenAI 的 /models 没有上下文窗口，但不少网关带了，字段名各家不同，有就记下来：
// 列表里没带的再查一次单模型详情（和 prometheus 的 providerModelsFetch 同一套取法）。

export interface GatewayTestInput {
  baseUrl: string
  apiKey?: string
}

export type GatewayTestResult =
  | { ok: true; latencyMs: number; models: string[]; contextWindows: Record<string, number> }
  | { ok: false; latencyMs: number; error: string }

const TIMEOUT_MS = 10_000
// 详情端点探测：请求数和模型数同阶、不消耗 token，但不要和列表请求叠加打爆连接
const DETAIL_TIMEOUT_MS = 5_000
const DETAIL_BUDGET_MS = 8_000
const DETAIL_CONCURRENCY = 8

// 同一事实在不同协议面上的键名不同（Anthropic / vLLM / 第三方网关），按顺序取第一个合法值
const CONTEXT_FIELDS = [
  'max_input_tokens',
  'max_model_len',
  'context_length',
  'context_window',
  'max_context_length',
] as const

// 防呆上限：挡住 Number.MAX_SAFE_INTEGER 之类的脏数据，不是任何模型的真实上限
const MAX_PLAUSIBLE_CONTEXT_WINDOW = 100_000_000

function contextWindowOf(model: Record<string, unknown>): number | undefined {
  for (const field of CONTEXT_FIELDS) {
    const raw = model[field]
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) continue
    if (value <= 0 || value > MAX_PLAUSIBLE_CONTEXT_WINDOW) continue
    return value
  }
  return undefined
}

// 单模型详情端点：OpenAI 兼容面一般支持 GET {baseUrl}/models/{model}，键名和列表一致。
// 超时 / 非 2xx / 解析失败都当作“取不到”，不影响连接测试本身。
async function fetchContextFromDetail(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  fetchImpl: typeof fetch,
): Promise<number | undefined> {
  try {
    const res = await fetchImpl(new URL(`${baseUrl}/models/${encodeURIComponent(model)}`), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    })
    if (!res.ok) return undefined
    const body = (await res.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body)
      ? contextWindowOf(body as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

// 列表里没报上下文的模型逐个查详情，总预算用尽后剩余模型按“取不到”处理
async function fillContextsFromDetails(
  baseUrl: string,
  apiKey: string | undefined,
  models: string[],
  contextWindows: Record<string, number>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const pending = models.filter((id) => contextWindows[id] === undefined)
  if (pending.length === 0) return
  const deadline = Date.now() + DETAIL_BUDGET_MS
  let next = 0
  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= pending.length || Date.now() >= deadline) return
      const model = pending[index]
      if (model === undefined) return
      const window = await fetchContextFromDetail(baseUrl, apiKey, model, fetchImpl)
      if (window !== undefined) contextWindows[model] = window
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, pending.length) }, worker))
}

export async function testGateway(
  input: GatewayTestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayTestResult> {
  const started = Date.now()
  const elapsed = () => Date.now() - started
  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(`${baseUrl}/models`)
  } catch {
    return { ok: false, latencyMs: 0, error: '地址格式不对' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, latencyMs: 0, error: '只支持 http 和 https 地址' }
  }
  try {
    const res = await fetchImpl(url, {
      headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        latencyMs: elapsed(),
        error: `鉴权失败（HTTP ${res.status}），检查 API Key`,
      }
    }
    if (!res.ok) return { ok: false, latencyMs: elapsed(), error: `网关返回 HTTP ${res.status}` }
    // 有的网关出错也回 200 带一个错误对象；没有 data 数组就当失败，不能当成“模型列表是空的”
    // 读响应体时超时、断开交给外层 catch；只有解析不了的 JSON 算“不是模型列表”
    const raw = await res.text()
    let body: { data?: unknown } | null = null
    try {
      body = JSON.parse(raw) as { data?: unknown } | null
    } catch {
      body = null
    }
    if (!body || !Array.isArray(body.data)) {
      return { ok: false, latencyMs: elapsed(), error: '网关返回的不是模型列表（缺少 data 数组）' }
    }
    const listed = (body.data as Record<string, unknown>[]).filter(
      (m): m is Record<string, unknown> & { id: string } =>
        typeof m?.id === 'string' && m.id.length > 0,
    )
    // 界面上显示的延迟只算列表请求，详情探测可能要好几秒，不计入
    const latencyMs = elapsed()
    const contextWindows: Record<string, number> = {}
    for (const m of listed) {
      const window = contextWindowOf(m)
      if (window) contextWindows[m.id] = window
    }
    const models = [...new Set(listed.map((m) => m.id))].sort()
    await fillContextsFromDetails(baseUrl, input.apiKey, models, contextWindows, fetchImpl)
    return { ok: true, latencyMs, models, contextWindows }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    if (err.name === 'TimeoutError')
      return { ok: false, latencyMs: elapsed(), error: '10 秒内没有响应' }
    const code = err.cause?.code
    if (code === 'ECONNREFUSED')
      return { ok: false, latencyMs: elapsed(), error: '连不上：端口没有服务在听' }
    if (code === 'ENOTFOUND')
      return { ok: false, latencyMs: elapsed(), error: '连不上：域名解析失败' }
    return { ok: false, latencyMs: elapsed(), error: `连不上：${err.message}` }
  }
}
