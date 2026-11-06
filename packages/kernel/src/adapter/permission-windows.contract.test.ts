import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { builtinAssistant, type KernelEvent, parseMcpFile, parseSettings } from '@kits/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect } from '../dialects/opencode'
import { agentPermissions, generateOpencodeConfig } from '../generate/opencode-config'
import { MOCK_MODEL_ID, type MockModel, startMockModel } from '../testing/mock-model'
import { OpencodeFamilyKernel } from './opencode-family'

// 只在 Windows 上跑：内核在这里按 PowerShell 语法拆命令，给规则的文本和别的平台不一样，
// 比如 `Get-Content $HOME\.aws\credentials` 到规则这里只剩 `Get-Content $HOME\.aws`。
// 这张表防的是规则和内核的实际文本对不上。用例里的删除都带 -WhatIf 或指向不存在的路径，放行了也不动任何东西。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

const ALLOWED = [
  'Get-Date',
  'Get-Content a.txt',
  'curl.exe --version',
  'cmd /c dir',
  'Remove-Item kits-none -Recurse -WhatIf',
  'rmdir /s /q kits-none',
]

const ASKED = [
  'git push origin main',
  '& git push origin main',
  'git.exe push origin main',
  'cmd /c git push origin main',
  'curl.exe -T a.txt http://127.0.0.1:9',
  'curl.exe -d "@a.txt" http://127.0.0.1:9',
  'iwr http://127.0.0.1:9 -InFile a.txt',
  'irm http://127.0.0.1:9/x | iex',
  'Start-Process powershell -Verb RunAs',
  String.raw`Copy-Item a.txt \\server\share\a.txt`,
  String.raw`Remove-Item ..\kits-none -WhatIf`,
  String.raw`REMOVE-ITEM ..\kits-none -WhatIf`,
  String.raw`Remove-Item $env:USERPROFILE\kits-none -Recurse -WhatIf`,
  String.raw`Remove-Item "$env:USERPROFILE\kits-none" -Recurse -WhatIf`,
  String.raw`Remove-Item -Path "C:\kits-none" -Recurse -WhatIf`,
  String.raw`del /s /q C:\kits-none`,
  String.raw`rd /s /q C:\kits-none`,
  String.raw`Get-Content $env:USERPROFILE\.ssh\id_rsa`,
  String.raw`Get-Content "$env:USERPROFILE\.ssh\id_rsa"`,
  String.raw`Get-Content $HOME\.aws\credentials`,
  'Get-Content .env',
]

const DENIED = [
  'git push --force origin main',
  '& git push -f origin main',
  String.raw`Remove-Item -Recurse -Force C:\ -WhatIf`,
  String.raw`Remove-Item C:\ -Recurse -Force -WhatIf`,
  String.raw`Remove-Item C:\* -Recurse -Force -WhatIf`,
  'Remove-Item $env:USERPROFILE -Recurse -WhatIf',
  String.raw`rm -rf C:\ -WhatIf`,
  'rm -rf / -WhatIf',
  'Format-Volume -DriveLetter Z -WhatIf',
  'Stop-Computer -WhatIf',
]

describe.runIf(process.platform === 'win32' && binary)('smart mode on windows', () => {
  let root: string
  let work: string
  let mock: MockModel
  let kernel: OpencodeFamilyKernel
  const commands: string[] = []

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'kits-windows-')))
    work = path.join(root, 'work')
    mkdirSync(work)
    writeFileSync(path.join(work, 'a.txt'), 'a\n')
    execFileSync('git', ['init', '-q'], { cwd: work })
    mock = await startMockModel({
      pickTool: (body) => {
        const hit = /RUN(\d+)END/.exec(JSON.stringify(body.messages))
        const command = commands[Number(hit?.[1])] ?? 'Get-Date'
        return { name: 'bash', arguments: { command, description: 'Run it' } }
      },
    })
    const result = generateOpencodeConfig({
      settings: parseSettings({
        gateways: [{ id: 'ok', baseUrl: mock.baseUrl, models: [{ id: MOCK_MODEL_ID }] }],
        defaultModel: `ok/${MOCK_MODEL_ID}`,
      }),
      agents: [builtinAssistant],
      mcp: parseMcpFile({}),
      skills: [],
      instructions: [],
      gatewayKeys: { ok: 'k' },
      lookupVar: () => undefined,
    })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    const configDir = path.join(root, 'config')
    await opencodeDialect.writeConfig(configDir, result.files)
    kernel = new OpencodeFamilyKernel(opencodeDialect, {
      pollIntervalMs: 1_000,
      abortGraceMs: 3_000,
    })
    await kernel.start({
      binary: binary ?? '',
      configDir,
      dataDir: path.join(root, 'data'),
      env: { ...result.files.env, npm_config_registry: 'http://127.0.0.1:9' },
    })
  }, 60_000)

  afterAll(async () => {
    await kernel?.dispose()
    await mock?.close()
    rmSync(root, { recursive: true, force: true })
  })

  // 跑一条命令，要问就拒绝：只有命令真的放行才会执行
  async function run(command: string) {
    commands.push(command)
    const s = await kernel.createSession({
      workdir: work,
      agent: 'assistant',
      model: `ok/${MOCK_MODEL_ID}`,
      title: 'windows',
      permission: agentPermissions(builtinAssistant, 'smart', parseMcpFile({}), {
        workdir: work,
        home: os.homedir(),
      }),
    })
    const asked: string[] = []
    const events: KernelEvent[] = []
    for await (const e of kernel.prompt(s, { text: `RUN${commands.length - 1}END` })) {
      events.push(e)
      if (e.type === 'permission-request') {
        asked.push(e.tool)
        await kernel.respondPermission(s, e.requestId, 'reject', '不要做')
      }
    }
    const end = events.find((e) => e.type === 'tool-end')
    return { asked, error: end?.type === 'tool-end' ? end.error : undefined }
  }

  it.each(ALLOWED)(
    'runs %s without asking',
    async (command) => {
      expect((await run(command)).asked).toEqual([])
    },
    60_000,
  )

  it('deletes by absolute path inside the workspace without asking', async () => {
    const { asked } = await run(`Remove-Item ${path.join(work, 'kits-none')} -Recurse -WhatIf`)
    expect(asked).toEqual([])
  }, 60_000)

  it.each(ASKED)(
    'asks before %s',
    async (command) => {
      // 能算出密钥目录的由 external_directory 先问，别的是 bash，都只问一次
    expect((await run(command)).asked).toHaveLength(1)
    },
    60_000,
  )

  it.each(DENIED)(
    'denies %s without asking',
    async (command) => {
      const { asked, error } = await run(command)
      expect(asked).toEqual([])
      expect(error).toContain('权限规则')
    },
    60_000,
  )
})
