import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  env: { KITS_GW_CORP_KEY: 'test' },
}

describe('spawnEnv', () => {
  it('points every XDG home and the opencode home at the kits data dir', () => {
    const env = spawnEnv(cfg, {})
    const keys = [
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'XDG_STATE_HOME',
      'OPENCODE_TEST_HOME',
    ]
    for (const key of keys) expect(env[key]).toBe('/kits/data')
  })

  it('disables autoupdate, claude code config and network downloads but keeps project skills', () => {
    const env = spawnEnv(cfg, {})
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('1')
    // 项目的 .agents/skills 靠内核自己的外部技能发现
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBeUndefined()
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe('1')
    expect(env.OPENCODE_DISABLE_LSP_DOWNLOAD).toBe('1')
  })

  it('overrides inherited XDG variables and passes the secret env through', () => {
    const env = spawnEnv(cfg, { XDG_DATA_HOME: '/home/me/.local/share', KITS_GW_CORP_KEY: 'mine' })
    expect(env.XDG_DATA_HOME).toBe('/kits/data')
    expect(env.KITS_GW_CORP_KEY).toBe('test')
  })
})

describe.skipIf(!binary)('opencodeDialect.spawn', () => {
  it('starts opencode serve with per-instance auth and reports healthy', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-opencode-'))
    const dataDir = path.join(root, 'data')
    // 家目录级配置的 fixture：放在 dataDir 下的 .opencode/，只有 home 被重定向到 dataDir 时才会被加载
    mkdirSync(path.join(dataDir, '.opencode'), { recursive: true })
    writeFileSync(
      path.join(dataDir, '.opencode', 'opencode.json'),
      JSON.stringify({ username: 'kits-fixture' }),
    )
    const kernel = await opencodeDialect.spawn({
      ...cfg,
      configDir: path.join(root, 'config'),
      dataDir,
    })
    try {
      const anonymous = await fetch(`${kernel.baseUrl}/global/health`)
      expect(anonymous.status).toBe(401)
      const res = await fetch(`${kernel.baseUrl}/global/health`, { headers: kernel.headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ healthy: true })

      // 隔离：XDG 数据落在 dataDir，home 级配置从 dataDir/.opencode 读而不是用户家目录
      expect(existsSync(path.join(dataDir, 'opencode'))).toBe(true)
      const config = await fetch(`${kernel.baseUrl}/config`, { headers: kernel.headers })
      expect(config.status).toBe(200)
      expect(await config.json()).toMatchObject({ username: 'kits-fixture' })
    } finally {
      await kernel.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
