import { describe, expect, it } from 'vitest'
import { draftAfterSend } from './composer-draft'

describe('draftAfterSend', () => {
  it('empties the box when nothing changed during the send', () => {
    expect(draftAfterSend('改完提交', '改完提交')).toBe('')
  })

  it('keeps a queued message restored during the send', () => {
    expect(draftAfterSend('改完提交\n\n顺便看下日志', '改完提交')).toBe('顺便看下日志')
  })

  it('keeps what was typed after the sent text', () => {
    expect(draftAfterSend('改完提交，再跑测试', '改完提交')).toBe('，再跑测试')
  })

  it('keeps everything when the sent text was edited, nothing is lost', () => {
    expect(draftAfterSend('改完再提交', '改完提交')).toBe('改完再提交')
  })
})
