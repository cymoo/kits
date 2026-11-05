import type { SessionSummary } from '@kits/core/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { Ellipsis, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router'
import { t } from '../app/i18n'
import { errorText } from '../lib/errors'
import { kits } from '../lib/kits'
import { sessionKeys } from '../lib/sessions'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/Dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { StatusDot } from './StatusDot'

// 侧栏的一行会话（原型 shell.js）：… 或右键打开菜单，就地改名，删除前确认。

const MAX_TITLE = 120

function RenameInput({
  session,
  input,
  onDone,
}: {
  session: SessionSummary
  input: React.RefObject<HTMLInputElement | null>
  onDone(): void
}) {
  const [value, setValue] = useState(session.title)
  const [failed, setFailed] = useState(false)
  // Esc 收起时输入框失焦，不能再当保存
  const settled = useRef(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [input])
  const save = async () => {
    if (settled.current) return
    const title = value.trim()
    settled.current = true
    if (!title || title === session.title) return onDone()
    try {
      await kits.session.rename({ id: session.id, title })
      onDone()
    } catch {
      settled.current = false
      setFailed(true)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      settled.current = true
      onDone()
    }
  }
  return (
    <input
      ref={input}
      aria-label={t('nav.renameLabel')}
      aria-invalid={failed}
      maxLength={MAX_TITLE}
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        setFailed(false)
      }}
      onKeyDown={onKeyDown}
      onBlur={() => void save()}
      className={cx(
        'block h-8 w-full rounded-[8px] border bg-raised px-2 text-fg outline-none shadow-[0_0_0_3px_rgb(53_99_224/0.15)]',
        failed ? 'border-danger' : 'border-accent',
      )}
    />
  )
}

function RemoveDialog({
  session,
  open,
  onOpenChange,
}: {
  session: SessionSummary
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const viewing = useMatch(`/s/${session.id}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await kits.session.remove(session.id)
      // 这一行随列表更新卸载，先离开它的页面
      if (viewing) navigate('/')
      client.setQueryData<SessionSummary[]>(sessionKeys.list, (list) =>
        (list ?? []).filter((s) => s.id !== session.id),
      )
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px]! p-5" role="alertdialog">
        <DialogTitle className="m-0 mb-1.5 font-semibold text-[1.143rem]">
          {t('nav.removeTitle')}
        </DialogTitle>
        <DialogDescription className="m-0 text-fg-muted leading-[1.6] [overflow-wrap:anywhere]">
          {t('nav.removeBody', { title: session.title })}
        </DialogDescription>
        {error ? <p className="m-0 mt-2 text-[0.929rem] text-danger">{error}</p> : null}
        <div className="mt-[18px] flex justify-end gap-2">
          <Button className="h-[30px] px-3" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {t('nav.remove')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SessionRow({ session: s }: { session: SessionSummary }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pinned = s.pinnedAt !== null
  const busy = s.status === 'running' || s.status === 'waiting' || !!s.queued?.length
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 右键只是快捷方式，键盘走 … 按钮 */}
      <div
        className="group relative"
        onContextMenu={(e) => {
          if (renaming) return
          e.preventDefault()
          setMenu(true)
        }}
      >
        {renaming ? (
          <RenameInput session={s} input={input} onDone={() => setRenaming(false)} />
        ) : (
          <NavLink
            to={`/s/${s.id}`}
            title={s.title}
            className={({ isActive }) =>
              cx(
                // 按钮出现时给它让位，标题和状态字不被盖住
                'flex h-8 items-center gap-2 rounded-[8px] px-2 text-fg no-underline group-hover:bg-hover group-hover:pr-8 group-has-[button:focus-visible]:pr-8 group-has-[button[data-state=open]]:bg-hover group-has-[button[data-state=open]]:pr-8',
                isActive && 'bg-hover font-medium',
              )
            }
          >
            <StatusDot status={s.status} />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            {/* 运行中只有一个圆点，给读屏补上状态 */}
            {s.status === 'running' ? (
              <span className="sr-only">{t('nav.tag.running')}</span>
            ) : null}
            {s.status === 'waiting' || s.status === 'error' ? (
              <span
                className={cx(
                  'shrink-0 text-[0.857rem]',
                  s.status === 'error' ? 'text-danger' : 'text-warn',
                )}
              >
                {t(s.status === 'error' ? 'nav.tag.error' : 'nav.tag.waiting')}
              </span>
            ) : null}
          </NavLink>
        )}
        {/* 不用模态：选“重命名”后焦点要落到输入框。改名时菜单不卸载，关菜单时还要拦住焦点回到按钮 */}
        <Menu open={menu} onOpenChange={setMenu} modal={false}>
          <MenuTrigger
            aria-label={t('nav.more', { title: s.title })}
            title={t('nav.moreShort')}
            className={cx(
              renaming && 'hidden',
              'absolute top-1/2 right-1 flex h-[22px] w-[22px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted opacity-0 outline-none hover:bg-active hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover:opacity-100 data-[state=open]:bg-active data-[state=open]:text-fg data-[state=open]:opacity-100',
            )}
          >
            <Ellipsis size={14} />
          </MenuTrigger>
          <MenuContent
            className="min-w-[188px]"
            align="start"
            onCloseAutoFocus={(e) => {
              // 焦点交给改名输入框或确认框，不回到按钮
              if (renaming || removing) e.preventDefault()
            }}
          >
            <MenuItem onSelect={() => void kits.session.setPinned({ id: s.id, pinned: !pinned })}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {t(pinned ? 'nav.unpinShort' : 'nav.pinShort')}
            </MenuItem>
            <MenuItem onSelect={() => setRenaming(true)}>
              <Pencil size={14} />
              {t('nav.rename')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger disabled={busy} onSelect={() => setRemoving(true)}>
              <Trash2 size={14} />
              <span className="min-w-0 flex-1">{t('nav.remove')}</span>
              {busy ? (
                <span className="text-[0.857rem] text-fg-subtle">{t('nav.removeRunning')}</span>
              ) : null}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <RemoveDialog session={s} open={removing} onOpenChange={setRemoving} />
    </>
  )
}
