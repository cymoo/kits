import type { MemoryItem, MemoryScopeView } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from '../../../app/i18n'
import { basename } from '../../../lib/composer-prefs'
import { kits, useHomeLabel } from '../../../lib/kits'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { Segmented } from '../../../ui/Segmented'

// 设置 · 技能与记忆的记忆部分（原型 settings.html#skills 下半）：项目 / 个人两份，每条能改能删，能手动加。

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// 04 · 今天 / 10-29
function dateLabel(date: string): string {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00`)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return t('memory.today')
  return d.getFullYear() === now.getFullYear() ? date.slice(5) : date
}

function meta(m: MemoryItem): string {
  const from =
    m.origin === 'session'
      ? m.sessionTitle
        ? t('memory.fromSession', { title: m.sessionTitle })
        : t('memory.fromDeleted')
      : m.origin === 'manual'
        ? t('memory.manual')
        : t('memory.handwritten')
  return [from, dateLabel(m.date)].filter(Boolean).join(' · ')
}

const textArea =
  'min-h-[60px] w-full resize-y rounded-[8px] border border-line bg-raised px-3 py-2 text-fg leading-[1.55] outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgb(54_89_227/0.15)]'

export function MemorySection({ workdir }: { workdir: string | undefined }) {
  const client = useQueryClient()
  const homeLabel = useHomeLabel()
  const [picked, setScope] = useState<MemoryScopeView>('project')
  // 没有工作目录时只有个人的
  const scope: MemoryScopeView = workdir ? picked : 'personal'
  const where = scope === 'project' && workdir ? { scope, workdir } : { scope }
  const list = useQuery({
    queryKey: ['memory', scope, workdir ?? ''],
    queryFn: () => kits.memory.list(where),
  })
  const [editing, setEditing] = useState<number>()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (op: () => Promise<void>) => {
    setError(undefined)
    try {
      await op()
      setEditing(undefined)
      setAdding(false)
      setDraft('')
      await client.invalidateQueries({ queryKey: ['memory'] })
    } catch (e) {
      setError(errorText(e))
    }
  }
  const entries = list.data?.entries ?? []

  return (
    <section
      data-testid="memory"
      className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised"
    >
      <div className="flex items-center gap-2.5 border-line-soft border-b px-4 py-3">
        <b className="font-semibold">{t('memory.title')}</b>
        <small className="min-w-0 flex-1 truncate text-[0.923rem] text-fg-muted">
          {t('memory.hint')}
        </small>
        {workdir ? (
          <Segmented
            label={t('memory.scope')}
            value={scope}
            onChange={(v) => {
              setScope(v)
              setEditing(undefined)
              setAdding(false)
            }}
            options={[
              { value: 'project', label: t('memory.project', { dir: basename(workdir) }) },
              { value: 'personal', label: t('memory.personal') },
            ]}
          />
        ) : null}
      </div>
      {entries.map((m) =>
        editing === m.index ? (
          <div key={m.index} className="flex flex-col gap-2 border-line-soft border-b px-4 py-2.5">
            <textarea
              aria-label={t('memory.edit')}
              // biome-ignore lint/a11y/noAutofocus: 点了“编辑”就是要改这一条
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={textArea}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(undefined)}>
                {t('memory.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!draft.trim()}
                onClick={() =>
                  void run(() => kits.memory.update({ ...where, index: m.index, text: draft }))
                }
              >
                {t('memory.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={m.index}
            data-testid={`memory-${m.index}`}
            className="group flex items-start gap-3 border-line-soft border-b px-4 py-2.5 hover:bg-bg"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="leading-[1.55]">{m.text}</span>
              <span className="text-[0.885rem] text-fg-label">{meta(m)}</span>
            </span>
            <Button
              variant="link"
              className="text-fg-muted"
              aria-label={t('memory.editOne', { text: m.text })}
              onClick={() => {
                setEditing(m.index)
                setDraft(m.text)
              }}
            >
              {t('memory.edit')}
            </Button>
            <Button
              variant="link"
              className="text-fg-muted hover:text-danger"
              aria-label={t('memory.removeOne', { text: m.text })}
              onClick={() => void run(() => kits.memory.remove({ ...where, index: m.index }))}
            >
              {t('memory.remove')}
            </Button>
          </div>
        ),
      )}
      {list.isSuccess && entries.length === 0 && !adding ? (
        <p className="m-0 border-line-soft border-b px-4 py-3 text-[0.923rem] text-fg-muted">
          {t('memory.empty')}
        </p>
      ) : null}
      {adding ? (
        <div className="flex flex-col gap-2 border-line-soft border-b px-4 py-2.5">
          <textarea
            aria-label={t('memory.add')}
            // biome-ignore lint/a11y/noAutofocus: 点了“手动加一条”就是要写
            autoFocus
            value={draft}
            placeholder={t('memory.addHint')}
            onChange={(e) => setDraft(e.target.value)}
            className={textArea}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('memory.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!draft.trim()}
              onClick={() => void run(() => kits.memory.add({ ...where, text: draft }))}
            >
              {t('memory.save')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 border-line-soft border-b px-4 py-2 text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5 px-4 py-2.5 text-[0.923rem] text-fg-label">
        <span className={cx('min-w-0 flex-1 truncate')} title={list.data?.path}>
          {list.data
            ? scope === 'project'
              ? t('memory.projectPath', { path: homeLabel(list.data.path) })
              : t('memory.personalPath', { path: homeLabel(list.data.path) })
            : ''}
        </span>
        <Button
          className="h-[26px] px-2"
          onClick={() => {
            setAdding(true)
            setEditing(undefined)
            setDraft('')
          }}
        >
          {t('memory.add')}
        </Button>
        <Button
          className="h-[26px] px-2"
          onClick={() =>
            void kits.memory
              .open(where)
              .then(() => client.invalidateQueries({ queryKey: ['memory'] }))
          }
        >
          {t('memory.open')}
        </Button>
      </div>
    </section>
  )
}
