import { generalSettingsSchema, type PartView, type SessionSummary } from '@kits/core'
import { describe, expect, it } from 'vitest'
import { Notifier, type NotifyMessage } from './notifier'

const session = (status: SessionSummary['status'], patch: Partial<SessionSummary> = {}) =>
  ({
    id: 's1',
    title: '给兑换接口加幂等校验',
    status,
    turns: 2,
    updatedAt: 1,
    lastError: null,
    pinnedAt: null,
    ...patch,
  }) as SessionSummary

const permission = (id = 'p1'): PartView =>
  ({
    id,
    sessionId: 's1',
    status: 'pending',
    payload: { type: 'permission', tool: 'bash', patterns: ['uv run pytest'] },
  }) as unknown as PartView

function setup(opts: { focused?: boolean; done?: boolean } = {}) {
  const shown: NotifyMessage[] = []
  const badges: number[] = []
  const notifier = new Notifier({
    general: () => generalSettingsSchema.parse({ notifyOnDone: opts.done ?? false }),
    focused: () => opts.focused ?? false,
    session: () => session('waiting'),
    show: (m) => void shown.push(m),
    onWaitingCount: (n) => void badges.push(n),
  })
  return { notifier, shown, badges }
}

describe('Notifier', () => {
  it('tells about a command waiting for confirmation once', () => {
    const { notifier, shown } = setup()
    notifier.observe('session.part', permission())
    notifier.observe('session.part', permission())
    expect(shown).toEqual([
      { sessionId: 's1', title: '有命令等你确认 · 给兑换接口加幂等校验', body: 'uv run pytest' },
    ])
  })

  it('stays quiet while the window is in front', () => {
    const { notifier, shown } = setup({ focused: true })
    notifier.observe('session.part', permission())
    expect(shown).toEqual([])
  })

  it('tells about an error when a turn ends with one', () => {
    const { notifier, shown } = setup()
    notifier.observe('session.changed', session('running'))
    notifier.observe('session.changed', session('error', { lastError: '网关断开', updatedAt: 2 }))
    expect(shown[0]).toMatchObject({ title: '出错了 · 给兑换接口加幂等校验', body: '网关断开' })
  })

  it('tells about a finished session only when that is turned on', () => {
    const off = setup()
    off.notifier.observe('session.changed', session('running'))
    off.notifier.observe('session.changed', session('done', { updatedAt: 2 }))
    expect(off.shown).toEqual([])
    const on = setup({ done: true })
    on.notifier.observe('session.changed', session('running'))
    on.notifier.observe('session.changed', session('done', { updatedAt: 2 }))
    expect(on.shown[0]?.title).toBe('完成了 · 给兑换接口加幂等校验')
  })

  it('does not notify about sessions that were already done at startup', () => {
    const { notifier, shown } = setup({ done: true })
    notifier.observe('session.changed', session('done'))
    expect(shown).toEqual([])
  })

  it('counts the sessions waiting for the user', () => {
    const { notifier, badges } = setup()
    notifier.observe('session.changed', session('waiting'))
    notifier.observe('session.changed', session('done', { id: 's2' }))
    expect(badges).toEqual([1, 1])
  })
})
