import { describe, expect, it } from 'vitest'
import { fixDefaultModel, mergeModels, newGateway, suggestGatewayId } from './gateway'

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

describe('mergeModels', () => {
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
