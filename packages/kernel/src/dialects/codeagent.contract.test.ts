import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinAssistant, type KernelEvent, parseMcpFile, parseSettings } from '@kits/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OpencodeFamilyKernel } from '../adapter/opencode-family'
import { toCodeagentFiles } from '../generate/codeagent-config'
import { agentPermissions, generateOpencodeConfig } from '../generate/opencode-config'
import type { KernelSession } from '../kernel'
import { fakeCodeagentBinary } from '../testing/fake-codeagent'
import { codeagentDialect } from './codeagent'

// CodeAgent 契约测试：按文档写的假服务（testing/fake-codeagent-server.mjs），走真实的方言和适配器：
// 就绪行、Bearer、/api/v1、配置核对、建会话 → prompt → permission.requested → 回复 → prompt.completed。
// 真机行为以 docs/references/codeagent-checklist.md 为准。

let root: string
let kernel: OpencodeFamilyKernel
let baseUrl: string
let headers: Record<string, string>
const mcp = parseMcpFile({})

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'kits-codeagent-'))
  const result = generateOpencodeConfig({
    settings: parseSettings({
      gateways: [{ id: 'corp', baseUrl: 'https://gw.example/v1', models: [{ id: 'coder-main' }] }],
      defaultModel: 'corp/coder-main',
    }),
    agents: [builtinAssistant],
    mcp,
    skills: [],
    instructions: [],
    gatewayKeys: { corp: 'sk-corp' },
    lookupVar: () => undefined,
  })
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const files = toCodeagentFiles(result.files)
  const configDir = path.join(root, 'config')
  await codeagentDialect.writeConfig(configDir, files)
  kernel = new OpencodeFamilyKernel(codeagentDialect, { pollIntervalMs: 1_000 })
  const spawned = await kernel.start({
    binary: fakeCodeagentBinary(root),
    configDir,
    dataDir: path.join(root, 'data'),
    env: files.env,
  })
  void spawned
  // 适配器内部的地址和鉴权头：测试直接去看假服务收到了什么
  const k = kernel as unknown as { spawned: { baseUrl: string; headers: Record<string, string> } }
  baseUrl = k.spawned.baseUrl
  headers = k.spawned.headers
}, 30_000)

afterAll(async () => {
  await kernel?.dispose()
  rmSync(root, { recursive: true, force: true })
})

const fakeState = async () =>
  (await (await fetch(`${baseUrl}/api/v1/__state`, { headers })).json()) as {
    config: { model?: string; provider?: { corp?: { options?: { apiKey?: string } } } }
    patched: number
    prompts: { text: string; system?: string; agent?: string }[]
    replies: { id: string; reply: string }[]
    aborted: string[]
  }

async function session(): Promise<KernelSession> {
  return kernel.createSession({
    workdir: root,
    agent: 'assistant',
    model: 'corp/coder-main',
    title: 'contract',
    permission: agentPermissions(builtinAssistant, 'ask', mcp),
  })
}

async function run(s: KernelSession, text: string, reply: 'once' | 'reject' | 'abort' = 'once') {
  const events: KernelEvent[] = []
  for await (const e of kernel.prompt(s, { text, system: '只读' })) {
    events.push(e)
    if (e.type === 'permission-request') {
      if (reply === 'abort') await kernel.abort(s)
      else await kernel.respondPermission(s, e.requestId, reply)
    }
  }
  return events
}

describe('CodeAgent dialect against the fake service', () => {
  it('reads the ready line, uses the bearer token and patches the config it did not load', async () => {
    expect(headers.Authorization).toMatch(/^Bearer /)
    const state = await fakeState()
    expect(state.patched).toBe(1)
    expect(state.config.model).toBe('corp/coder-main')
    // {env:…} 换成了值（接口收到的 JSON 不会再替换环境变量）
    expect(state.config.provider?.corp?.options?.apiKey).toBe('sk-corp')
  })

  it('streams a turn through permission.requested to prompt.completed', async () => {
    const s = await session()
    const events = await run(s, '用 echo 打印 hi')
    expect(events.find((e) => e.type === 'permission-request')).toMatchObject({
      tool: 'bash',
      patterns: ['echo hi'],
    })
    expect(events.find((e) => e.type === 'tool-end')).toMatchObject({ output: 'hi\n', exitCode: 0 })
    const text = events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : [])).join('')
    expect(text).toBe('命令跑完了，结果是 hi。')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
    const state = await fakeState()
    expect(state.prompts.at(-1)).toMatchObject({ system: '只读', agent: 'kits-assistant' })
    expect(state.replies.at(-1)?.reply).toBe('once')
  }, 20_000)

  it('maps session.next.retried to a retry', async () => {
    const s = await session()
    const events = await run(s, '重试一下')
    expect(events.find((e) => e.type === 'retry')).toMatchObject({
      attempt: 1,
      message: 'gateway 503',
    })
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'completed' })
  }, 20_000)

  it('ends as aborted when stopped while waiting for a permission', async () => {
    const s = await session()
    const events = await run(s, '用 echo 打印 hi', 'abort')
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' })
    expect((await fakeState()).aborted).toContain(s.id)
  }, 20_000)
})
