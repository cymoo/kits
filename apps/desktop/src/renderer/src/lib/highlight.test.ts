import { describe, expect, it } from 'vitest'
import { languageOf, tokenize } from './highlight'

describe('languageOf', () => {
  it('goes by the extension', () => {
    expect(languageOf('src/a.py')).toBe('python')
  })

  it('ignores the case of the extension', () => {
    expect(languageOf('A.TS')).toBe('typescript')
  })

  it('knows a Dockerfile by its name', () => {
    expect(languageOf('deploy/Dockerfile')).toBe('docker')
  })

  it('has nothing for an unknown file', () => {
    expect(languageOf('notes.txt')).toBeUndefined()
    expect(languageOf('LICENSE')).toBeUndefined()
  })
})

describe('tokenize', () => {
  it('gives a light and a dark color for each token', async () => {
    const lines = await tokenize('def a():\n    return 1\n', 'python')
    expect(lines[0]?.[0]).toMatchObject({ content: 'def' })
    expect(lines[0]?.[0]?.htmlStyle).toMatchObject({
      color: expect.any(String),
      '--shiki-dark': expect.any(String),
    })
  })
})
