import type { QueuedDraft } from '@kits/core/ipc'

// 退回来的草稿暂存在这里：原来的会话不在屏幕上时，等切回去再放进输入框
const held = new Map<string, QueuedDraft>()

export function holdDraft(sessionId: string, draft: QueuedDraft): void {
  const prev = held.get(sessionId)
  held.set(
    sessionId,
    prev
      ? {
          text: `${prev.text}\n\n${draft.text}`,
          attachments: [...prev.attachments, ...draft.attachments],
        }
      : draft,
  )
}

export function takeDraft(sessionId: string): QueuedDraft | undefined {
  const draft = held.get(sessionId)
  held.delete(sessionId)
  return draft
}
