import { z } from 'zod'
import { askUserInputSchema } from './ask-user'
import { rememberInputSchema } from './remember'

// kits 工具的会话关联（phase1-implementation 5.3 节）。
// 内核调 MCP 工具时不带会话 id。适配器在事件流里看到 kits 工具的 tool-start（带 sessionId 和 input）就登记，
// 工具服务收到调用时按“工具名 + 参数”匹配最近 10 s 内的登记。调用可能比事件先到，匹配时最多等一会儿。

// 两边看到的参数形状不一样：事件流里是模型给的原样参数，工具服务拿到的是按 schema 解析过的（补了默认值、去了多余字段）。
// 匹配前都按同一个 schema 解析一遍。
const SCHEMAS: Record<string, z.ZodType> = {
  ask_user: askUserInputSchema,
  remember: rememberInputSchema,
  submit_output: z.object({ output: z.unknown() }),
}

export function normalizeKitsToolInput(tool: string, input: unknown): unknown {
  const parsed = SCHEMAS[tool]?.safeParse(input)
  return parsed?.success ? parsed.data : input
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

interface Entry {
  sessionId: string
  at: number
}

export interface ToolCallRegistryOptions {
  ttlMs?: number
  now?: () => number
}

export class ToolCallRegistry {
  private entries = new Map<string, Entry[]>()
  private waiters = new Map<string, ((sessionId: string) => void)[]>()
  private readonly ttl: number
  private readonly now: () => number

  constructor(options: ToolCallRegistryOptions = {}) {
    this.ttl = options.ttlMs ?? 10_000
    this.now = options.now ?? Date.now
  }

  private key(tool: string, input: unknown): string {
    return `${tool}\u0000${stableStringify(normalizeKitsToolInput(tool, input))}`
  }

  register(sessionId: string, tool: string, input: unknown): void {
    const key = this.key(tool, input)
    const waiting = this.waiters.get(key)
    const waiter = waiting?.shift()
    if (waiter) {
      if (waiting?.length === 0) this.waiters.delete(key)
      waiter(sessionId)
      return
    }
    const list = this.entries.get(key) ?? []
    list.push({ sessionId, at: this.now() })
    this.entries.set(key, list)
  }

  // 先找已登记的（最早的一条，同一参数两个会话各调一次时按先后对上），没有就等 waitMs
  async match(tool: string, input: unknown, waitMs = 2_000): Promise<string | undefined> {
    const key = this.key(tool, input)
    const fresh = (this.entries.get(key) ?? []).filter((e) => this.now() - e.at <= this.ttl)
    const hit = fresh.shift()
    if (fresh.length > 0) this.entries.set(key, fresh)
    else this.entries.delete(key)
    if (hit) return hit.sessionId
    if (waitMs <= 0) return undefined
    return new Promise((resolve) => {
      const waiter = (sessionId: string) => {
        clearTimeout(timer)
        resolve(sessionId)
      }
      const timer = setTimeout(() => {
        const list = this.waiters.get(key) ?? []
        const rest = list.filter((w) => w !== waiter)
        if (rest.length > 0) this.waiters.set(key, rest)
        else this.waiters.delete(key)
        resolve(undefined)
      }, waitMs)
      const list = this.waiters.get(key) ?? []
      list.push(waiter)
      this.waiters.set(key, list)
    })
  }
}
