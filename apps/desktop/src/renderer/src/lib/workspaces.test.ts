import type { SessionSummary } from '@kits/core/ipc'
import { describe, expect, it } from 'vitest'
import { buildWorkspaces, dirName, foldedStatus } from './workspaces'

const session = (id: string, workdir: string, extra: Partial<SessionSummary> = {}) =>
  ({
    id,
    workdir,
    status: 'done',
    createdAt: 1,
    updatedAt: 1,
    pinnedAt: null,
    ...extra,
  }) as SessionSummary

describe('buildWorkspaces', () => {
  it('lists a directory that only sessions know about', () => {
    const [w] = buildWorkspaces([], [session('a', '/repo/kits')])
    expect(w).toMatchObject({ path: '/repo/kits', name: 'kits' })
  })

  it('keeps a directory without sessions', () => {
    const [w] = buildWorkspaces([{ path: '/repo/kits', lastUsedAt: 0 }], [])
    expect(w?.sessions).toEqual([])
  })

  it('merges a path with and without the trailing slash', () => {
    const list = buildWorkspaces(
      [{ path: '/repo/kits/', lastUsedAt: 0 }],
      [session('a', '/repo/kits')],
    )
    expect(list).toHaveLength(1)
  })

  it('shows the label instead of the directory name', () => {
    const [w] = buildWorkspaces([{ path: '/repo/kits', label: '测试平台', lastUsedAt: 0 }], [])
    expect(w?.name).toBe('测试平台')
  })

  it('leaves a pinned session out of its group but counts it for removal', () => {
    const [w] = buildWorkspaces([], [session('a', '/w', { pinnedAt: 5 }), session('b', '/w')])
    expect(w?.sessions.map((s) => s.id)).toEqual(['b'])
    expect(w?.all).toHaveLength(2)
  })

  it('sorts the sessions of a group by the latest activity', () => {
    const [w] = buildWorkspaces(
      [],
      [session('old', '/w', { updatedAt: 1 }), session('new', '/w', { updatedAt: 9 })],
    )
    expect(w?.sessions.map((s) => s.id)).toEqual(['new', 'old'])
  })

  it('does not move a group when one of its old sessions gets new content', () => {
    const list = buildWorkspaces(
      [],
      [
        session('a', '/a', { createdAt: 1, updatedAt: 99 }),
        session('b', '/b', { createdAt: 5, updatedAt: 5 }),
      ],
    )
    expect(list.map((w) => w.path)).toEqual(['/b', '/a'])
  })
})

describe('foldedStatus', () => {
  it('prefers what waits for the user', () => {
    const [w] = buildWorkspaces(
      [],
      [session('a', '/w', { status: 'running' }), session('b', '/w', { status: 'waiting' })],
    )
    expect(w && foldedStatus(w)).toBe('waiting')
  })
})

describe('dirName', () => {
  it('takes the last part of a Windows path', () => {
    expect(dirName('C:\\repo\\kits\\')).toBe('kits')
  })
})
