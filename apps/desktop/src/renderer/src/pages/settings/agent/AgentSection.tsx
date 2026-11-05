import type { AgentDraft, AgentSource, AgentView, PermissionLevel } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { type MessageKey, t } from '../../../app/i18n'
import {
  isAllowed,
  sameDraft,
  setToolLevel,
  toggleAllowed,
  toolLevel,
  uniqueName,
} from '../../../lib/agent-edit'
import { basename, usePrefs } from '../../../lib/composer-prefs'
import { kits, useHomeLabel, useSettings } from '../../../lib/kits'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { Dialog, DialogContent, DialogTitle } from '../../../ui/Dialog'
import { Field, Input } from '../../../ui/Input'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from '../../../ui/Menu'
import { Segmented } from '../../../ui/Segmented'

// 设置 · Agent（原型 settings.html#agent）：左边三级来源的列表，右边编辑一份 Agent 文件。
// 内置的只读，复制一份存成个人或项目的；没保存的改动按 Agent 各自留着，切回来还在。

type Key = string
const keyOf = (a: { source: AgentSource; name: string }): Key => `${a.source}:${a.name}`

interface Entry {
  // 已经存在的（新建还没保存的没有）
  saved?: AgentView
  source: AgentSource
  draft: AgentDraft
}

const LEVEL_TONE: Record<PermissionLevel, string> = {
  allow: 'data-[state=checked]:text-ok',
  ask: 'data-[state=checked]:text-warn-strong',
  deny: 'data-[state=checked]:text-danger',
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const card = 'flex flex-col gap-2 rounded-[16px] border border-line bg-raised px-4 py-3.5'
const chip = 'inline-flex h-[26px] items-center rounded-[13px] px-2.5 font-mono text-[0.929rem]'

export function AgentSection() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const settings = useSettings()
  const homeLabel = useHomeLabel()
  const workdirs = settings.data?.workdirs ?? []
  const [pickedDir, setPickedDir] = useState<string>()
  const workdir = pickedDir ?? workdirs[0]?.path
  const overview = useQuery({
    queryKey: ['agents', 'overview', workdir ?? ''],
    queryFn: () => kits.agents.overview(workdir ? { workdir } : {}),
  })
  const skills = useQuery({
    queryKey: ['skills', workdir ?? ''],
    queryFn: () => kits.skills.list(workdir ? { workdir } : {}),
  })
  const mcp = useQuery({ queryKey: ['mcp', 'overview'], queryFn: () => kits.mcp.overview() })

  const agents = overview.data?.agents ?? []
  // 改过还没保存的草稿，和新建还没保存的 Agent
  const [drafts, setDrafts] = useState<Record<Key, Entry>>({})
  const [selected, setSelected] = useState<Key>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string>()
  // 删除要点两下：第一下变成“确认删除”
  const [confirming, setConfirming] = useState(false)

  const entries = useMemo(() => {
    const fresh = Object.entries(drafts)
      .filter(([, e]) => !e.saved)
      .map(([k, e]) => [k, e] as const)
    const existing = agents.map(
      (a) => [keyOf(a), drafts[keyOf(a)] ?? { saved: a, source: a.source, draft: a }] as const,
    )
    return [...fresh, ...existing]
  }, [agents, drafts])
  const current = entries.find(([k]) => k === selected) ?? entries[0]
  const [currentKey, entry] = current ?? []
  const view = entry?.saved
  const draft = entry?.draft
  const readonly = entry?.source === 'builtin'
  const dirty = !!entry && (!entry.saved || !sameDraft(entry.draft, entry.saved))
  const defaults = (view ?? agents[0])?.defaults ?? {}

  const allSkills = (skills.data?.skills ?? []).filter((s) => s.enabled).map((s) => s.name)
  const allServers = (mcp.data?.servers ?? []).filter((s) => s.enabled).map((s) => s.name)
  const gateways = (settings.data?.gateways ?? []).filter((g) => g.enabled && g.models.length)

  const edit = (patch: (d: AgentDraft) => AgentDraft) => {
    if (!entry || !currentKey || readonly) return
    setError(undefined)
    setDrafts((all) => ({ ...all, [currentKey]: { ...entry, draft: patch(entry.draft) } }))
  }
  const refresh = () => client.invalidateQueries({ queryKey: ['agents'] })

  // 新建 / 复制：先放进草稿，保存时才写文件
  const create = (source: 'personal' | 'project', from?: AgentDraft) => {
    const taken = agents.filter((a) => a.source === source).map((a) => a.name)
    const name = uniqueName(from ? `${from.name}-copy` : 'new-agent', taken)
    const key = `new:${source}:${name}:${Date.now()}`
    const base: AgentDraft = from
      ? { ...from, name }
      : { name, description: '', permissions: {}, prompt: '' }
    setDrafts((all) => ({ ...all, [key]: { source, draft: base } }))
    setSelected(key)
    setError(undefined)
  }

  const save = async (): Promise<AgentView | undefined> => {
    if (!entry || !draft || !currentKey || entry.source === 'builtin') return
    setSaving(true)
    setError(undefined)
    try {
      const saved = await kits.agents.save({
        source: entry.source,
        ...(entry.source === 'project' && workdir ? { workdir } : {}),
        ...(entry.saved ? { original: entry.saved.name } : {}),
        draft,
      })
      setDrafts(({ [currentKey]: _, ...rest }) => rest)
      setSelected(keyOf(saved))
      await refresh()
      return saved
    } catch (e) {
      setError(errorText(e))
      return undefined
    } finally {
      setSaving(false)
    }
  }

  const ref = (a: AgentView) => ({
    name: a.name,
    source: a.source,
    ...(a.source === 'project' && workdir ? { workdir } : {}),
  })

  const remove = async () => {
    if (!entry || !currentKey) return
    setError(undefined)
    if (entry.saved) {
      try {
        await kits.agents.remove(ref(entry.saved))
      } catch (e) {
        setError(errorText(e))
        return
      }
    }
    setDrafts(({ [currentKey]: _, ...rest }) => rest)
    setSelected(undefined)
    await refresh()
  }

  const addOutput = async () => {
    // 有没保存的改动先存，免得新建输出格式时把它们丢了
    const target = dirty || !view ? await save() : view
    if (!target) return
    try {
      await kits.agents.createOutput(ref(target))
      await refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const showPreview = async () => {
    if (!entry || !draft) return
    try {
      setPreview(
        await kits.agents.preview({
          source: entry.source,
          ...(workdir ? { workdir } : {}),
          ...(entry.saved ? { original: entry.saved.name } : {}),
          draft,
        }),
      )
    } catch (e) {
      setError(errorText(e))
    }
  }

  const startSession = () => {
    if (!view) return
    usePrefs.getState().set({
      agent: view.name,
      ...(view.source === 'project' && workdir ? { workdir } : {}),
    })
    navigate('/')
  }

  const newMenu = (label: string, from?: AgentDraft) => (
    <Menu>
      <MenuTrigger asChild>
        <Button className="h-[26px] px-2">
          {from ? null : <Plus size={13} />}
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t('agents.saveTo')}</MenuLabel>
        <MenuItem onSelect={() => create('personal', from)}>
          <span className="flex flex-col">
            <span>{t('agents.personal')}</span>
            <small className="text-[0.857rem] text-fg-muted">~/.kits/agents/</small>
          </span>
        </MenuItem>
        {workdir ? (
          <MenuItem onSelect={() => create('project', from)}>
            <span className="flex flex-col">
              <span>{t('agents.projectOf', { dir: basename(workdir) })}</span>
              <small className="text-[0.857rem] text-fg-muted">.agents/agents/</small>
            </span>
          </MenuItem>
        ) : null}
      </MenuContent>
    </Menu>
  )

  return (
    <div className="flex w-full max-w-[1000px] items-start gap-7">
      <div className="flex w-[240px] shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="m-0 flex-1 font-semibold text-[1rem]">{t('settings.agent')}</h2>
          {newMenu(t('agents.new'))}
        </div>
        {workdirs.length > 1 ? (
          <Menu>
            <MenuTrigger className="mx-1 inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[0.857rem] text-fg-muted hover:bg-active">
              {t('agents.projectOf', { dir: workdir ? basename(workdir) : '' })}
              <ChevronDown size={12} />
            </MenuTrigger>
            <MenuContent>
              {workdirs.map((w) => (
                <MenuItem key={w.path} onSelect={() => setPickedDir(w.path)}>
                  <span className="font-mono text-[0.929rem]">{homeLabel(w.path)}</span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-px p-0" aria-label={t('settings.agent')}>
          {entries.map(([k, e]) => {
            const on = k === currentKey
            const unsaved = !e.saved || !sameDraft(e.draft, e.saved)
            return (
              <li key={k}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  data-testid={`agent-item-${e.draft.name}`}
                  onClick={() => {
                    setSelected(k)
                    setConfirming(false)
                    setError(undefined)
                  }}
                  className={cx(
                    'flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-left',
                    on ? 'bg-raised shadow-[0_0_0_1px_var(--k-border)]' : 'hover:bg-active',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="flex items-center gap-1.5 font-medium font-mono text-[0.929rem]">
                      <span className="truncate">{e.draft.name}</span>
                      {unsaved && e.source !== 'builtin' ? (
                        <span
                          role="img"
                          aria-label={t('agents.unsaved')}
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      ) : null}
                    </span>
                    <span className="truncate text-[0.929rem] text-fg-muted">
                      {e.draft.description || t('agents.noDescription')}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-[8px] bg-hover px-[7px] py-px text-[0.857rem] text-fg-muted">
                    {t(`source.${e.source}` as MessageKey)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {overview.data?.errors.map((e) => (
          <p
            key={e.path}
            role="alert"
            className="m-0 rounded-[12px] bg-danger-bg px-3 py-2 text-[0.857rem] text-danger"
          >
            {t('agents.loadError', { path: homeLabel(e.path), message: e.message })}
          </p>
        ))}
        <p className="mx-1 mt-2 mb-0 text-[0.857rem] text-fg-label leading-[1.6]">
          {t('agents.footnote')}
        </p>
      </div>

      {entry && draft ? (
        <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-[22px]">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 className="m-0 truncate font-mono font-semibold text-[1.429rem]">{draft.name}</h2>
              <span className="truncate font-mono text-fg-muted" title={view?.path}>
                {readonly
                  ? t('agents.builtinFile')
                  : view?.path
                    ? homeLabel(view.path)
                    : t('agents.notSaved')}
              </span>
            </div>
            {view ? <Button onClick={startSession}>{t('agents.startSession')}</Button> : null}
            {view?.path && !readonly ? (
              <Button
                onClick={() =>
                  void kits.agents.open({ ...ref(view), what: 'file' }).catch((e) => {
                    setError(errorText(e))
                  })
                }
              >
                {t('agents.openFile')}
              </Button>
            ) : null}
          </div>

          {readonly ? null : (
            <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3.5">
              <Field label={t('agents.name')}>
                <Input
                  mono
                  value={draft.name}
                  onChange={(e) => edit((d) => ({ ...d, name: e.target.value.trim() }))}
                />
              </Field>
              <Field label={t('agents.description')}>
                <Input
                  value={draft.description}
                  placeholder={t('agents.descriptionHint')}
                  onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))}
                />
              </Field>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{t('agents.prompt')}</span>
              <small className="text-[0.929rem] text-fg-muted">{t('agents.promptHint')}</small>
            </div>
            <textarea
              aria-label={t('agents.prompt')}
              rows={8}
              readOnly={readonly}
              value={draft.prompt}
              placeholder={t('agents.promptEmpty')}
              onChange={(e) => edit((d) => ({ ...d, prompt: e.target.value }))}
              className="resize-y rounded-[12px] border border-line bg-raised px-3.5 py-3 font-mono text-[0.929rem] text-fg leading-[1.65] outline-none placeholder:text-fg-subtle focus:border-accent focus:shadow-[0_0_0_3px_rgb(54_89_227/0.15)] read-only:bg-bg"
            />
          </section>

          <section className="grid grid-cols-2 gap-3.5">
            <div className={card}>
              <span className="font-semibold">{t('agents.model')}</span>
              <Menu>
                <MenuTrigger
                  disabled={readonly}
                  className="flex h-[34px] cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-raised px-3 text-left disabled:cursor-default disabled:bg-bg"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.929rem]">
                    {draft.model || t('agents.defaultModel')}
                  </span>
                  <ChevronDown size={12} className="text-fg-muted" />
                </MenuTrigger>
                <MenuContent>
                  <MenuRadioGroup
                    value={draft.model ?? ''}
                    onValueChange={(v) =>
                      edit(({ model: _, ...d }) => (v ? { ...d, model: v } : d))
                    }
                  >
                    <MenuRadioItem value="">{t('agents.defaultModel')}</MenuRadioItem>
                    {gateways.map((g) => (
                      <div key={g.id}>
                        <MenuLabel>{g.name || g.id}</MenuLabel>
                        {g.models.map((m) => (
                          <MenuRadioItem key={m.id} value={`${g.id}/${m.id}`}>
                            <span className="font-mono text-[0.929rem]">{m.id}</span>
                          </MenuRadioItem>
                        ))}
                      </div>
                    ))}
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
              <span className="text-[0.929rem] text-fg-muted">
                {draft.model ? t('agents.modelOwn') : t('agents.modelFollow')}
              </span>
            </div>
            <div className={card}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t('agents.output')}</span>
                <small className="text-[0.929rem] text-fg-muted">{t('agents.outputHint')}</small>
              </div>
              {draft.output ? (
                <>
                  <div className="flex h-[34px] items-center gap-2 rounded-[8px] border border-line bg-bg px-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.929rem]">
                      {draft.output}
                    </span>
                    {view?.path && !readonly ? (
                      <Button
                        variant="link"
                        onClick={() =>
                          void kits.agents.open({ ...ref(view), what: 'output' }).catch((e) => {
                            setError(errorText(e))
                          })
                        }
                      >
                        {t('agents.edit')}
                      </Button>
                    ) : null}
                  </div>
                  <span className="text-[0.929rem] text-fg-muted">
                    {view && !view.hasOutputSchema && view.output === draft.output
                      ? t('agents.outputBroken')
                      : t('agents.outputOn')}
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={readonly || saving}
                    onClick={() => void addOutput()}
                    className="flex h-[34px] cursor-pointer items-center rounded-[8px] border border-line-strong border-dashed bg-raised px-3 text-left text-fg-muted enabled:hover:bg-active disabled:cursor-default"
                  >
                    {t('agents.outputNone')}
                  </button>
                  <span className="text-[0.929rem] text-fg-muted">
                    {readonly ? t('agents.outputNoneHint') : t('agents.outputAdd')}
                  </span>
                </>
              )}
            </div>
          </section>

          <section className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-raised">
            <div className="flex items-baseline gap-2.5 border-line-soft border-b px-4 py-3">
              <b className="font-semibold">{t('agents.tools')}</b>
              <small className="text-[0.929rem] text-fg-muted">{t('agents.toolsHint')}</small>
            </div>
            {Object.keys(defaults).map((tool) => (
              <div
                key={tool}
                data-testid={`agent-tool-${tool}`}
                className="flex min-h-10 items-center gap-3 border-line-soft border-b px-4 py-1.5 last:border-b-0"
              >
                <span className="w-[156px] shrink-0 font-mono text-[0.929rem]">{tool}</span>
                <span className="min-w-0 flex-1 truncate text-[0.929rem] text-fg-muted">
                  {t(`agents.tool.${tool}` as MessageKey)}
                </span>
                {readonly ? (
                  <span className="text-[0.929rem] text-fg-muted">
                    {t(`mcp.${toolLevel(draft, tool, defaults)}` as MessageKey)}
                  </span>
                ) : (
                  <Segmented
                    label={t('agents.toolLevel', { tool })}
                    value={toolLevel(draft, tool, defaults)}
                    onChange={(level) => edit((d) => setToolLevel(d, tool, level, defaults))}
                    options={(['allow', 'ask', 'deny'] as const).map((level) => ({
                      value: level,
                      label: t(`mcp.${level}`),
                      className: LEVEL_TONE[level],
                    }))}
                  />
                )}
              </div>
            ))}
          </section>

          <section className="grid grid-cols-2 gap-3.5">
            <AllowCard
              title={t('agents.skills')}
              testId="agent-skills"
              note={
                draft.skills
                  ? t('agents.someOf', {
                      n: draft.skills.filter((s) => allSkills.includes(s)).length,
                    })
                  : t('agents.allSkills')
              }
              all={allSkills}
              list={draft.skills}
              prefix="/"
              readonly={readonly}
              allLabel={t('agents.allSkills')}
              onChange={(skills) => edit(({ skills: _, ...d }) => (skills ? { ...d, skills } : d))}
            />
            <AllowCard
              title="MCP"
              testId="agent-mcp"
              note={
                draft.mcp
                  ? t('agents.someOf', {
                      n: draft.mcp.filter((s) => allServers.includes(s)).length,
                    })
                  : t('agents.allServers')
              }
              all={allServers}
              list={draft.mcp}
              prefix=""
              readonly={readonly}
              allLabel={t('agents.allServers')}
              onChange={(mcp) => edit(({ mcp: _, ...d }) => (mcp ? { ...d, mcp } : d))}
            />
          </section>

          {error ? (
            <p
              role="alert"
              className="m-0 rounded-[12px] bg-danger-bg px-3.5 py-2 text-[0.929rem] text-danger"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2.5 rounded-[12px] bg-bg px-3.5 py-3 text-[0.929rem] text-fg-muted">
            <span className="flex-1">
              {readonly ? t('agents.builtinNote') : t('agents.saveNote')}
            </span>
            {readonly ? null : (
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={() => {
                  if (entry.saved && !confirming) return setConfirming(true)
                  setConfirming(false)
                  void remove()
                }}
                onBlur={() => setConfirming(false)}
              >
                {entry.saved
                  ? confirming
                    ? t('agents.confirmDelete')
                    : t('agents.delete')
                  : t('agents.discard')}
              </Button>
            )}
            <Button variant="link" onClick={() => void showPreview()}>
              {t('agents.preview')}
            </Button>
            {readonly ? (
              newMenu(t('agents.copy'), draft)
            ) : (
              <Button
                variant="primary"
                disabled={!dirty || saving || !draft.name}
                onClick={() => void save()}
              >
                {t('agents.save')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <Dialog open={preview !== undefined} onOpenChange={(o) => !o && setPreview(undefined)}>
        <DialogContent className="w-[720px]">
          <div className="flex flex-col gap-3 p-5">
            <DialogTitle className="m-0 font-semibold text-[1.143rem]">
              {t('agents.previewTitle')}
            </DialogTitle>
            <p className="m-0 text-fg-muted">{t('agents.previewHint')}</p>
            <pre
              data-testid="agent-preview"
              className="m-0 max-h-[60vh] overflow-auto rounded-[12px] bg-bg p-3.5 font-mono text-[0.857rem] leading-[1.6]"
            >
              {preview}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 技能 / MCP 的允许列表：芯片显示用不用，“调整”里逐个开关；全开 = 不限制
function AllowCard({
  title,
  testId,
  note,
  all,
  list,
  prefix,
  readonly,
  allLabel,
  onChange,
}: {
  title: string
  testId: string
  note: string
  all: string[]
  list: string[] | undefined
  prefix: string
  readonly: boolean
  allLabel: string
  onChange(list: string[] | undefined): void
}) {
  return (
    <div className={card} data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{title}</span>
        <small className="text-[0.929rem] text-fg-muted">{note}</small>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {all.length === 0 ? (
          <span className="text-[0.929rem] text-fg-muted">{t('agents.noneAvailable')}</span>
        ) : null}
        {all.map((name) => (
          <span
            key={name}
            className={cx(
              chip,
              isAllowed(list, name)
                ? 'bg-active text-fg'
                : 'border border-line text-fg-subtle line-through',
            )}
          >
            {prefix}
            {name}
          </span>
        ))}
        {readonly || all.length === 0 ? null : (
          <Menu>
            <MenuTrigger className="inline-flex h-[26px] cursor-pointer items-center rounded-[13px] border border-line-strong border-dashed px-2.5 text-[0.929rem] text-fg-muted hover:bg-active">
              {t('agents.adjust')}
            </MenuTrigger>
            <MenuContent>
              <MenuSwitchItem
                checked={!list}
                onCheckedChange={(on) => onChange(on ? undefined : [...all])}
              >
                {allLabel}
              </MenuSwitchItem>
              <MenuSeparator />
              {all.map((name) => (
                <MenuSwitchItem
                  key={name}
                  checked={isAllowed(list, name)}
                  onCheckedChange={() => onChange(toggleAllowed(list, all, name))}
                >
                  <span className="font-mono text-[0.929rem]">
                    {prefix}
                    {name}
                  </span>
                </MenuSwitchItem>
              ))}
            </MenuContent>
          </Menu>
        )}
      </div>
    </div>
  )
}
