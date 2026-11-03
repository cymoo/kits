import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveKernelBinary } from '../binary'
import { opencodeDialect, spawnEnv } from './opencode'

// 契约测试：启动真实的 opencode serve，验证方言层的启动、就绪判断和关闭。不调模型。
const binary = resolveKernelBinary('opencode', {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
})

const cfg = {
  binary: binary ?? '',
  configDir: '/kits/config',
  dataDir: '/kits/data',
  gateway: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test' },
}

describe('spawnEnv', () => {
  it('points every XDG home at the kits data dir', () => {
    const env = spawnEnv(cfg, {})
    for (const key of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME']) {
      expect(env[key]).toBe('/kits/data')
    }
  })

  it('disables autoupdate, external skills and claude code config', () => {
    const env = spawnEnv(cfg, {})
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('1')
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe('1')
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
  })

  it('overrides inherited XDG and gateway variables', () => {
    const env = spawnEnv(cfg, { XDG_DATA_HOME: '/home/me/.local/share', OPENAI_API_KEY: 'mine' })
    expect(env.XDG_DATA_HOME).toBe('/kits/data')
    expect(env.OPENAI_API_KEY).toBe('test')
  })
})

describe.skipIf(!binary)('opencodeDialect.spawn', () => {
  it('starts opencode serve with per-instance auth and reports healthy', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-opencode-'))
    const kernel = await opencodeDialect.spawn({
      ...cfg,
      configDir: path.join(root, 'config'),
      dataDir: path.join(root, 'data'),
    })
    try {
      const anonymous = await fetch(`${kernel.baseUrl}/global/health`)
      expect(anonymous.status).toBe(401)
      const res = await fetch(`${kernel.baseUrl}/global/health`, { headers: kernel.headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ healthy: true })
    } finally {
      await kernel.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
