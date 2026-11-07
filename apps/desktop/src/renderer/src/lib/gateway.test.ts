import { describe, expect, it } from 'vitest'
import {
  firstImageModel,
  fixDefaultModel,
  mergeModels,
  newGateway,
  suggestGatewayId,
  supportsImages,
} from './gateway'

describe('suggestGatewayId', () => {
  it('takes a meaningful label from the host name', () => {
    expect(suggestGatewayId('https://llm-gateway.corp.example/v1', [])).toBe('llm-gateway')
    expect(suggestGatewayId('https://api.corp.example/v1', [])).toBe('corp')
    expect(suggestGatewayId('http://localhost:8000/v1', [])).toBe('localhost')
  })

  it('adds a suffix when the id is taken and falls back for bad urls', () => {
    expect(suggestGatewayId('https://api.corp.example/v1', ['corp', 'corp-2'])).toBe('corp-3')
    expect(suggestGatewayId('nope', [])).toBe('gateway')
    // corp_2 已经占了 KITS_GW_CORP_2_KEY，不能再给 corp-2
    expect(suggestGatewayId('https://api.corp.example/v1', ['corp', 'corp_2'])).toBe('corp-3')
    expect(suggestGatewayId('http://10.0.0.8:8000/v1', [])).toBe('10-0-0-8')
  })
})

describe('supportsImages', () => {
  const model = { note: '', contextWindow: 128_000, toolCall: true }
  const gw = (id: string, enabled: boolean, models: { id: string; vision?: boolean }[]) => ({
    id,
    name: id,
    baseUrl: '',
    enabled,
    models: models.map((m) => ({ ...model, ...m })),
  })
  const gateways = [
    gw('off', false, [{ id: 'eye', vision: true }]),
    gw('corp', true, [{ id: 'text' }, { id: 'org/eye', vision: true }]),
  ]

  it('is true only for a model marked as seeing, on an enabled gateway', () => {
    expect(supportsImages(gateways, 'corp/org/eye')).toBe(true)
    expect(supportsImages(gateways, 'corp/text')).toBe(false)
    expect(supportsImages(gateways, 'off/eye')).toBe(false)
    expect(supportsImages(gateways, '')).toBe(false)
  })

  it('finds the first seeing model on an enabled gateway', () => {
    expect(firstImageModel(gateways)).toBe('corp/org/eye')
    expect(firstImageModel([gateways[0] as (typeof gateways)[0]])).toBeUndefined()
  })
})

describe('mergeModels', () => {
  it('takes what the gateway reports about images for models not decided yet', () => {
    const current = [{ id: 'a', note: '', contextWindow: 64_000, toolCall: true }]
    expect(mergeModels(current, ['a', 'b'], {}, { a: true, b: false })).toMatchObject([
      { id: 'a', vision: true },
      { id: 'b', vision: false },
    ])
  })

  it('keeps an image switch that was already set', () => {
    const current = [{ id: 'a', note: '', contextWindow: 64_000, toolCall: true, vision: true }]
    expect(mergeModels(current, ['a'], {}, { a: false })[0]?.vision).toBe(true)
  })

  it('keeps notes and context windows of models still listed', () => {
    const current = [{ id: 'a', note: '主力', contextWindow: 64_000, toolCall: true }]
    expect(mergeModels(current, ['a', 'b'])).toEqual([
      current[0],
      { id: 'b', note: '', contextWindow: 128_000, toolCall: true },
    ])
  })

  it('takes the context window the gateway reports for new models', () => {
    expect(mergeModels([], ['a'], { a: 1_048_576 })).toEqual([
      { id: 'a', note: '', contextWindow: 1_048_576, toolCall: true },
    ])
  })

  it('replaces the default context window of a listed model', () => {
    const current = [{ id: 'a', note: '主力', contextWindow: 128_000, toolCall: true }]
    expect(mergeModels(current, ['a'], { a: 1_048_576 })).toEqual([
      { id: 'a', note: '主力', contextWindow: 1_048_576, toolCall: true },
    ])
  })

  it('keeps a context window the user changed', () => {
    const current = [{ id: 'a', note: '', contextWindow: 64_000, toolCall: true }]
    expect(mergeModels(current, ['a'], { a: 1_048_576 })).toEqual(current)
  })
})

describe('fixDefaultModel', () => {
  const gws = [
    { ...newGateway({ id: 'off', name: '', baseUrl: '', models: ['x'] }), enabled: false },
    newGateway({ id: 'on', name: '', baseUrl: '', models: ['y', 'z'] }),
  ]

  it('keeps a usable default and replaces one on a disabled gateway', () => {
    expect(fixDefaultModel(gws, 'on/z')).toBe('on/z')
    expect(fixDefaultModel(gws, 'off/x')).toBe('on/y')
    expect(fixDefaultModel([], 'on/z')).toBe('')
  })
})
