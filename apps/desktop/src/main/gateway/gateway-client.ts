// 网关连接测试（phase1-implementation 3.1 节）：GET {baseUrl}/models 拿模型列表并量延迟。
// 不发对话请求、不计入用量。地址只认 http(s)，超时 10 s。
// OpenAI 的 /models 没有上下文窗口，但不少网关带了，字段名各家不同，有就记下来。

export interface GatewayTestInput {
  baseUrl: string
  apiKey?: string
}

export type GatewayTestResult =
  | { ok: true; latencyMs: number; models: string[]; contextWindows: Record<string, number> }
  | { ok: false; latencyMs: number; error: string }

const TIMEOUT_MS = 10_000

// DeepSeek 等是 context_window，OpenRouter 是 context_length，vLLM 是 max_model_len
const CONTEXT_FIELDS = ['context_window', 'context_length', 'max_context_length', 'max_model_len']

function contextWindowOf(model: Record<string, unknown>): number | undefined {
  return CONTEXT_FIELDS.map((f) => model[f]).find(
    (n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0,
  )
}

export async function testGateway(
  input: GatewayTestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayTestResult> {
  const started = Date.now()
  const elapsed = () => Date.now() - started
  let url: URL
  try {
    url = new URL(`${input.baseUrl.replace(/\/+$/, '')}/models`)
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
    const contextWindows: Record<string, number> = {}
    for (const m of listed) {
      const window = contextWindowOf(m)
      if (window) contextWindows[m.id] = window
    }
    const models = [...new Set(listed.map((m) => m.id))].sort()
    return { ok: true, latencyMs: elapsed(), models, contextWindows }
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
