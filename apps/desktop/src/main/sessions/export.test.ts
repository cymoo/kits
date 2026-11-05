import type { MessageView, PartPayload, PartView, SessionDetail } from '@kits/core'
import { describe, expect, it } from 'vitest'
import { sessionMarkdown } from './export'

const message = (id: string, role: MessageView['role'], text: string, createdAt: number) =>
  ({ id, role, text, createdAt, sessionId: 's1', turn: 1 }) as MessageView
const part = (seq: number, payload: PartPayload, status: string | null = null) =>
  ({ id: `p${seq}`, messageId: 'a1', seq, type: payload.type, payload, status }) as PartView
const detail = (messages: MessageView[], parts: PartView[]) =>
  ({
    session: { title: '加幂等校验', workdir: '/w', agent: 'assistant', model: 'corp/m' },
    messages,
    parts,
    attachments: [],
  }) as unknown as SessionDetail

describe('sessionMarkdown', () => {
  it('writes the conversation in order with one line per tool', () => {
    const text = sessionMarkdown(
      detail(
        [message('a1', 'assistant', '', 2), message('u1', 'user', '改一下', 1)],
        [
          part(0, { type: 'tool', callId: 'c', name: 'read', input: {} }, 'completed'),
          part(1, { type: 'text', text: '改好了' }),
        ],
      ),
    )
    expect(text).toContain('# 加幂等校验')
    expect(text.indexOf('改一下')).toBeLessThan(text.indexOf('改好了'))
    expect(text).toContain('- `read`\n\n改好了')
  })

  it('marks a failed tool', () => {
    const text = sessionMarkdown(
      detail(
        [message('a1', 'assistant', '', 2)],
        [part(0, { type: 'tool', callId: 'c', name: 'bash', input: {} }, 'error')],
      ),
    )
    expect(text).toContain('- `bash`（失败）')
  })

  it('leaves out an assistant message without readable content', () => {
    const text = sessionMarkdown(
      detail([message('a1', 'assistant', '', 2)], [part(0, { type: 'reasoning', text: '想想' })]),
    )
    expect(text).not.toContain('## Agent')
  })

  it('keeps a settings notice as a quote', () => {
    const text = sessionMarkdown(detail([message('n1', 'notice', 'model:corp/fast', 3)], []))
    expect(text).toContain('> 模型切换到 corp/fast')
  })
})
