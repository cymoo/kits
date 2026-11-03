import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect } from './opencode'

// 契约测试：启动真实的 opencode serve，验证方言层的启动、就绪判断和关闭。不调模型。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

describe.skipIf(!binary)('opencodeDialect.spawn', () => {
  it('starts opencode serve on a free port and reports healthy', async () => {
    const configDir = mkdtempSync(path.join(os.tmpdir(), 'kits-opencode-'))
    const kernel = await opencodeDialect.spawn({
      binary: binary ?? '',
      configDir,
      gateway: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test' },
    })
    try {
      const res = await fetch(`${kernel.baseUrl}/global/health`)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ healthy: true })
    } finally {
      await kernel.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 30_000)
})
