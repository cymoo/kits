import { describe, expect, it } from 'vitest'
import { findModel, parseModelRef } from './gateway'
import { parseSettings } from './settings'

describe('parseSettings', () => {
  it('fills every default for an empty file', () => {
    const s = parseSettings(undefined)
    expect(s).toMatchObject({
      version: 2,
      kernel: 'opencode',
      permissionMode: 'smart',
      gateways: [],
      onboardingDone: false,
    })
    expect(s.general).toMatchObject({ theme: 'system', uiScale: 'm', keepRunning: true })
  })

  it('defaults a model context window to 128K', () => {
    const s = parseSettings({ gateways: [{ id: 'corp', models: [{ id: 'm' }] }] })
    expect(s.gateways[0]?.models[0]).toMatchObject({ contextWindow: 128_000, toolCall: true })
  })

  it('rejects a gateway id that is not safe for env names', () => {
    expect(() => parseSettings({ gateways: [{ id: 'Corp GW' }] })).toThrow()
  })

  it('rejects a gateway url that is not http or https', () => {
    expect(() => parseSettings({ gateways: [{ id: 'a', baseUrl: 'file:///x' }] })).toThrow()
  })
})

describe('parseModelRef', () => {
  it('splits on the first slash so model ids may contain slashes', () => {
    expect(parseModelRef('corp/deepseek/v4')).toEqual({ gateway: 'corp', model: 'deepseek/v4' })
  })

  it('returns undefined for a ref without a gateway', () => {
    expect(parseModelRef('deepseek')).toBeUndefined()
    expect(parseModelRef('/m')).toBeUndefined()
  })
})

describe('findModel', () => {
  it('only finds models on enabled gateways', () => {
    const { gateways } = parseSettings({
      gateways: [
        { id: 'a', enabled: false, models: [{ id: 'm' }] },
        { id: 'b', models: [{ id: 'm' }] },
      ],
    })
    expect(findModel(gateways, 'a/m')).toBeUndefined()
    expect(findModel(gateways, 'b/m')?.gateway.id).toBe('b')
  })

  it('defaults new installs to the smart permission mode', () => {
    expect(parseSettings(undefined).permissionMode).toBe('smart')
  })

  it('moves a version 1 file off the old ask default', () => {
    const s = parseSettings({ version: 1, permissionMode: 'ask', defaultModel: 'corp/m' })
    expect(s).toMatchObject({ version: 2, permissionMode: 'smart', defaultModel: 'corp/m' })
  })

  it('keeps the other modes of a version 1 file', () => {
    expect(parseSettings({ version: 1, permissionMode: 'auto' }).permissionMode).toBe('auto')
  })

  it('keeps ask once it was chosen on version 2', () => {
    expect(parseSettings({ version: 2, permissionMode: 'ask' }).permissionMode).toBe('ask')
  })
})
