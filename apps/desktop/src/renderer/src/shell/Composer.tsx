import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Folder,
  FolderOpen,
  Shield,
  SlidersHorizontal,
} from 'lucide-react'
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../app/i18n'
import { basename, resolvePrefs, usePrefs } from '../lib/composer-prefs'
import { kits, useSettings } from '../lib/kits'
import { cx } from '../ui/cx'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSegmented,
  MenuSeparator,
  MenuTrigger,
} from '../ui/Menu'

// 输入框（原型 shell.js 的 <k-composer>）：文本区自动长高；目录、Agent、权限、内核与模型四个浮层；↵ 发送、⇧↵ 换行。
// 首页（big）发送时新建会话；会话页发送时在当前会话里接着说。`/`、`@` 菜单和 `+` 在 PR11、PR13 做。

const PERMS = ['ask', 'read', 'auto'] as const

export interface ComposerSubmit {
  text: string
  workdir: string
  agent: string
  permissionMode: (typeof PERMS)[number]
  kernel: 'opencode' | 'codeagent'
  model: string
}

const chip =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 text-[0.962rem] text-fg-muted outline-none hover:bg-active hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg'

export function Composer({
  big = false,
  placeholder,
  disabled = false,
  // 会话页：目录、Agent、内核和模型跟着会话走，不能改
  locked = false,
  lockedAs,
  onSubmit,
}: {
  lockedAs?: {
    workdir: string
    agent: string
    model: string
    permissionMode: (typeof PERMS)[number]
  }
  big?: boolean
  placeholder: string
  disabled?: boolean
  locked?: boolean
  onSubmit(input: ComposerSubmit): Promise<void> | void
}) {
  const navigate = useNavigate()
  const settings = useSettings()
  const prefs = usePrefs()
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => kits.agents.list() })
  const agentModel = agents.data?.find((a) => a.name === prefs.agent)?.model
  const resolved = resolvePrefs(prefs, settings.data, agentModel)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // 发送失败的原因（比如工作目录被删了）；草稿留着，改了再发
  const [error, setError] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)

  // 自动长高，最多 220px
  // biome-ignore lint/correctness/useExhaustiveDependencies: 文本变了才需要重算高度
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const missing = locked
    ? undefined
    : !resolved.workdir
      ? 'workdir'
      : !resolved.model
        ? 'model'
        : undefined
  const canSend = !!text.trim() && !missing && !disabled && !sending

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    setError(undefined)
    try {
      await onSubmit({ ...resolved, workdir: resolved.workdir ?? '', text: text.trim() })
      setText('')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const pickDir = async () => {
    const dir = await kits.workdir.pick()
    if (dir) prefs.set({ workdir: dir })
  }

  const gateways = (settings.data?.gateways ?? []).filter((g) => g.enabled && g.models.length > 0)
  const modelLabel = resolved.model
    ? resolved.model.slice(resolved.model.indexOf('/') + 1)
    : t('composer.noModel')

  return (
    <div
      className={cx(
        'relative border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,.03),0_6px_20px_rgba(0,0,0,.05)] transition-[border-color,box-shadow] focus-within:border-line-strong focus-within:shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_28px_rgba(0,0,0,.08)]',
        big ? 'rounded-[16px]' : 'rounded-[14px]',
      )}
    >
      <label htmlFor={big ? 'composer-home' : 'composer-session'} className="sr-only">
        {t('composer.label')}
      </label>
      <textarea
        ref={area}
        id={big ? 'composer-home' : 'composer-session'}
        rows={big ? 3 : 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cx(
          'block max-h-[220px] w-full resize-none border-0 bg-transparent text-fg leading-[1.6] outline-none placeholder:text-fg-subtle',
          big ? 'px-[18px] pt-4 pb-2 text-[1.154rem]' : 'px-3.5 pt-3 pb-1 text-[1.077rem]',
        )}
      />
      {error ? (
        <p
          role="alert"
          className={cx('m-0 text-[0.923rem] text-danger', big ? 'px-[18px]' : 'px-3.5')}
        >
          {error}
        </p>
      ) : null}
      <div
        className={cx(
          'flex flex-wrap items-center gap-0.5',
          big ? 'px-2.5 pt-1.5 pb-2.5' : 'px-2 pt-1 pb-2',
        )}
      >
        {locked && lockedAs ? (
          // 会话页：目录、Agent、模型跟着会话走，只显示不能改
          <>
            <span
              className={cx(chip, 'cursor-default hover:bg-transparent hover:text-fg-muted')}
              title={lockedAs.workdir}
            >
              <Folder size={13} />
              <span className="font-mono text-[0.923rem]">{basename(lockedAs.workdir)}</span>
            </span>
            <span className={cx(chip, 'cursor-default hover:bg-transparent hover:text-fg-muted')}>
              <Bot size={13} />
              <span>{lockedAs.agent}</span>
            </span>
          </>
        ) : null}
        {locked ? null : (
          <>
            <Menu>
              <MenuTrigger
                className={cx(chip, missing === 'workdir' && 'text-accent')}
                title={t('composer.workdir')}
              >
                {resolved.workdir ? <Folder size={13} /> : <FolderOpen size={13} />}
                <span className="font-mono text-[0.923rem]">
                  {resolved.workdir ? basename(resolved.workdir) : t('composer.pickWorkdir')}
                </span>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{t('composer.workdir')}</MenuLabel>
                <MenuRadioGroup
                  value={resolved.workdir ?? ''}
                  onValueChange={(v) => prefs.set({ workdir: v })}
                >
                  {(settings.data?.workdirs ?? []).map((w) => (
                    <MenuRadioItem key={w.path} value={w.path}>
                      <span className="block font-mono text-[0.923rem]">{basename(w.path)}</span>
                      <small className="block truncate text-[0.923rem] text-fg-muted">
                        {w.path}
                      </small>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                {settings.data?.workdirs.length ? <MenuSeparator /> : null}
                <MenuItem onSelect={() => void pickDir()}>
                  <FolderOpen size={14} className="text-fg-muted" />
                  {t('composer.openDir')}
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger className={chip} title="Agent">
                <Bot size={13} />
                <span>{resolved.agent}</span>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Agent</MenuLabel>
                <MenuRadioGroup
                  value={resolved.agent}
                  onValueChange={(v) => prefs.set({ agent: v })}
                >
                  {(
                    agents.data ?? [
                      { name: 'assistant', description: '', source: 'builtin' as const },
                    ]
                  ).map((a) => (
                    <MenuRadioItem key={a.name} value={a.name}>
                      <span className="block font-mono text-[0.923rem]">{a.name}</span>
                      <small className="block text-[0.923rem] text-fg-muted">
                        {[a.description, t(`source.${a.source}`)].filter(Boolean).join(' · ')}
                      </small>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem onSelect={() => navigate('/settings/agent')}>
                  <SlidersHorizontal size={14} className="text-fg-muted" />
                  {t('composer.manageAgents')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        )}
        <span className="flex-1" />
        <Menu>
          <MenuTrigger
            className={
              locked ? cx(chip, 'cursor-default hover:bg-transparent hover:text-fg-muted') : chip
            }
            title={t('composer.permission')}
            disabled={locked}
          >
            <Shield size={13} />
            <span>{t(`perm.${lockedAs?.permissionMode ?? resolved.permissionMode}`)}</span>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>{t('composer.permissionTitle')}</MenuLabel>
            <MenuRadioGroup
              value={resolved.permissionMode}
              onValueChange={(v) => prefs.set({ permissionMode: v as (typeof PERMS)[number] })}
            >
              {PERMS.map((p) => (
                <MenuRadioItem key={p} value={p}>
                  <span className="block">{t(`perm.${p}`)}</span>
                  <small className="block text-[0.923rem] text-fg-muted">
                    {t(`perm.${p}.note`)}
                  </small>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        {locked && lockedAs ? (
          <span className={cx(chip, 'cursor-default hover:bg-transparent hover:text-fg-muted')}>
            <span className="font-mono text-[0.923rem]">
              {lockedAs.model.slice(lockedAs.model.indexOf('/') + 1)}
            </span>
          </span>
        ) : null}
        {locked ? null : (
          <Menu>
            <MenuTrigger
              className={cx(chip, missing === 'model' && 'text-accent')}
              title={t('composer.model')}
            >
              <span className="font-mono text-[0.923rem]">{modelLabel}</span>
              <ChevronDown size={12} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuSegmented
                label={t('composer.kernel')}
                value={resolved.kernel}
                onChange={(v) => prefs.set({ kernel: v })}
                options={[
                  { value: 'opencode', label: 'OpenCode' },
                  { value: 'codeagent', label: 'CodeAgent' },
                ]}
              />
              {gateways.length === 0 ? (
                <p className="m-0 px-2 py-2 text-fg-muted">{t('composer.noGateway')}</p>
              ) : null}
              {gateways.map((g) => (
                <MenuRadioGroup
                  key={g.id}
                  value={resolved.model}
                  onValueChange={(v) => prefs.set({ model: v })}
                >
                  <MenuLabel>{g.name || g.id}</MenuLabel>
                  {g.models.map((m) => (
                    <MenuRadioItem key={m.id} value={`${g.id}/${m.id}`}>
                      <span className="font-mono text-[0.923rem]">{m.id}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => navigate('/settings/model')}>
                <SlidersHorizontal size={14} className="text-fg-muted" />
                {t('composer.modelSettings')}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        <span className="mr-1.5 text-[0.885rem] text-fg-subtle">{t('composer.newline')}</span>
        <button
          type="button"
          aria-label={t('composer.send')}
          title={missing ? t(`composer.missing.${missing}`) : `${t('composer.send')} ↵`}
          disabled={!canSend}
          onClick={() => void submit()}
          className="ml-1 flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-primary text-primary-fg transition-opacity disabled:cursor-default disabled:opacity-25"
        >
          <ArrowUp size={14} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
