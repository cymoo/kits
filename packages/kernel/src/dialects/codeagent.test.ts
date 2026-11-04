import { describe, expect, it } from 'vitest'
import { resolveEnvRefs, toCodeagentFiles } from '../generate/codeagent-config'
import { DESCRIBE_BASH_PLUGIN_PATH } from '../generate/describe-bash-plugin'
import { codeagentEnv, parseReadyLine } from './codeagent'

describe('parseReadyLine', () => {
  it('reads the base url and token from the ready line', () => {
    const line = JSON.stringify({
      type: 'codeagent.server.ready',
      base_url: 'http://127.0.0.1:50773/',
      auth: { token: 't' },
      version: '0.9.4',
    })
    expect(parseReadyLine(line)).toEqual({
      baseUrl: 'http://127.0.0.1:50773',
      token: 't',
      version: '0.9.4',
    })
  })

  it('ignores other log lines and other json', () => {
    expect(parseReadyLine('starting server')).toBeUndefined()
    expect(parseReadyLine('{"type":"log","msg":"x"}')).toBeUndefined()
    expect(parseReadyLine('{not json')).toBeUndefined()
  })
})

describe('codeagentEnv', () => {
  it('points the home-like dirs at the kits data dir and adds the config env last', () => {
    const env = codeagentEnv(
      { binary: '', configDir: '/c', dataDir: '/d', env: { KITS_GW_CORP_KEY: 'k' } },
      { PATH: '/bin' },
    )
    expect(env).toMatchObject({ PATH: '/bin', XDG_DATA_HOME: '/d', KITS_GW_CORP_KEY: 'k' })
  })
})

describe('toCodeagentFiles', () => {
  it('renames the config file and drops the opencode schema', () => {
    const out = toCodeagentFiles({
      files: [{ path: 'opencode.json', content: '{"$schema":"x","model":"corp/m"}' }],
      env: { A: '1' },
    })
    expect(out.files[0]?.path).toBe('codeagent.json')
    expect(JSON.parse(out.files[0]?.content ?? '')).toEqual({ model: 'corp/m' })
    expect(out.env).toEqual({ A: '1' })
  })

  it('leaves out the opencode plugin until it is checked on a real kernel', () => {
    const out = toCodeagentFiles({
      files: [
        { path: 'opencode.json', content: '{}' },
        { path: DESCRIBE_BASH_PLUGIN_PATH, content: '' },
      ],
      env: {},
    })
    expect(out.files.map((f) => f.path)).toEqual(['codeagent.json'])
  })
})

describe('resolveEnvRefs', () => {
  it('replaces env references everywhere and leaves unknown ones', () => {
    expect(
      resolveEnvRefs(
        { a: '{env:KEY}', b: ['x-{env:KEY}'], c: { d: '{env:MISSING}' }, n: 1 },
        { KEY: 'v' },
      ),
    ).toEqual({ a: 'v', b: ['x-v'], c: { d: '{env:MISSING}' }, n: 1 })
  })
})
