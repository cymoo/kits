// 网关连接测试（phase1-implementation 3.1 节）：GET {baseUrl}/models 拿模型列表并量延迟。
// 不发对话请求、不计入用量。地址只认 http(s)，超时 10 s。

export interface GatewayTestInput {
  baseUrl: string
  apiKey?: string
}

export type GatewayTestResult =
  | { ok: true; latencyMs: number; models: string[] }
  | { ok: false; latencyMs: number; error: string }

const TIMEOUT_MS = 10_000

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
    const body = (await res.json()) as { data?: { id?: unknown }[] }
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return { ok: true, latencyMs: elapsed(), models: [...new Set(models)].sort() }
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
