import { describe, expect, it } from 'vitest'
import { holdDraft, takeDraft } from './held-drafts'

describe('held drafts', () => {
  it('gives a held draft back to its own session, once', () => {
    holdDraft('a', { text: '第一条', attachments: [] })

    expect(takeDraft('b')).toBeUndefined()
    expect(takeDraft('a')?.text).toBe('第一条')
    expect(takeDraft('a')).toBeUndefined()
  })

  it('joins drafts held for the same session', () => {
    const file = { name: 'a.md', mime: 'text/markdown', data: new Uint8Array() }
    holdDraft('a', { text: '第一条', attachments: [file] })
    holdDraft('a', { text: '第二条', attachments: [] })

    expect(takeDraft('a')).toEqual({ text: '第一条\n\n第二条', attachments: [file] })
  })
})
