import type { GeneralSettings } from '@kits/core/ipc'
import { Check, ChevronDown } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { type MessageKey, t } from '../../../app/i18n'
import { CODE_FONTS, installedFonts, UI_FONTS } from '../../../lib/fonts'
import { kits, useAppInfo, useSettings, useUpdateSettings } from '../../../lib/kits'
import { modLabel, shortcuts } from '../../../lib/shortcuts'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '../../../ui/Menu'
import { Segmented } from '../../../ui/Segmented'
import { Switch } from '../../../ui/Switch'

// 设置 · 通用（原型 settings.html#general）：外观、字体、语言与启动、通知、快捷键表。改了立刻生效。

type Theme = GeneralSettings['theme']

// 主题选项上的小预览：侧栏、两行字、一张卡片
const PREVIEW: Record<'light' | 'dark', { bg: string; side: string; line: string; card: string }> =
  {
    light: { bg: '#FFFFFF', side: '#F1F0EC', line: '#D9D8D2', card: '#F1F4FF' },
    dark: { bg: '#1F1F22', side: '#161618', line: '#3F3F46', card: '#1E2340' },
  }

function ThemePreview({ theme }: { theme: Theme }) {
  const half = (mode: 'light' | 'dark') => {
    const p = PREVIEW[mode]
    return (
      <span className="flex h-full flex-1" style={{ background: p.bg }}>
        <span className="w-[26%]" style={{ background: p.side }} />
        <span className="flex flex-1 flex-col gap-1 p-2">
          <span className="block h-[5px] w-[70%] rounded-[3px]" style={{ background: p.line }} />
          <span className="block h-[5px] w-[45%] rounded-[3px]" style={{ background: p.line }} />
          <span className="mt-auto block h-[18px] w-full rounded" style={{ background: p.card }} />
        </span>
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-[72px] w-full overflow-hidden rounded-[8px] border border-line"
    >
      {theme === 'system' ? (
        <>
          <span className="flex flex-1 overflow-hidden">{half('light')}</span>
          <span className="flex flex-1 overflow-hidden">{half('dark')}</span>
        </>
      ) : (
        half(theme)
      )}
    </span>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised">
      <div className="flex items-baseline gap-2.5 border-line-soft border-b px-[18px] py-3">
        <b className="font-semibold">{title}</b>
        {hint ? <small className="text-[0.923rem] text-fg-muted">{hint}</small> : null}
      </div>
      {children}
    </section>
  )
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-line-soft border-b px-[18px] py-3 last:border-b-0">
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="font-medium">{label}</span>
        {note ? <span className="text-[0.923rem] text-fg-muted">{note}</span> : null}
      </span>
      {children}
    </div>
  )
}

function FontPicker({
  label,
  value,
  options,
  fallback,
  mono,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  fallback: string
  mono?: boolean
  onChange(v: string): void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      <Menu>
        <MenuTrigger
          aria-label={label}
          className={cx(
            'flex h-[34px] cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-raised px-3 text-left hover:bg-active',
            mono && 'font-mono text-[0.962rem]',
          )}
          style={value ? { fontFamily: `"${value}"` } : undefined}
        >
          <span className="min-w-0 flex-1 truncate">{value || fallback}</span>
          <ChevronDown size={12} className="text-fg-muted" />
        </MenuTrigger>
        <MenuContent>
          <MenuRadioGroup value={value} onValueChange={onChange}>
            <MenuRadioItem value="">{fallback}</MenuRadioItem>
            {options.map((f) => (
              <MenuRadioItem key={f} value={f}>
                <span style={{ fontFamily: `"${f}"` }}>{f}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </div>
  )
}

const KEYS: [MessageKey, string][] = [
  ['general.key.new', shortcuts.newSession.label],
  ['general.key.search', shortcuts.search.label],
  ['general.key.settings', shortcuts.settings.label],
  ['general.key.stop', shortcuts.stop.label],
  ['general.key.allow', `${modLabel}↵`],
  ['general.key.reject', 'Esc'],
  ['general.key.send', '↵ / ⇧↵'],
  ['general.key.nav', shortcuts.toggleNav.label],
  ['general.key.wide', shortcuts.widePanel.label],
]

export function GeneralSection() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const g = settings.data?.general
  // 本机装了哪些字体：量一次就够
  const fonts = useMemo(
    () => ({ ui: installedFonts(UI_FONTS), code: installedFonts(CODE_FONTS) }),
    [],
  )
  if (!g) return null
  const set = (patch: Partial<GeneralSettings>) => update.mutate({ general: patch })

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
          {t('settings.general')}
        </h2>
        <p className="m-0 text-fg-muted">{t('general.intro')}</p>
      </div>

      <Card title={t('general.appearance')}>
        <div className="flex flex-col gap-2.5 border-line-soft border-b px-[18px] py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{t('general.theme')}</span>
            <small className="text-[0.923rem] text-fg-muted">{t('general.themeHint')}</small>
          </div>
          <div
            role="radiogroup"
            aria-label={t('general.theme')}
            className="grid grid-cols-3 gap-2.5"
          >
            {(['light', 'dark', 'system'] as const).map((theme) => {
              const on = g.theme === theme
              return (
                // biome-ignore lint/a11y/useSemanticElements: 选项里有预览图，按原型用按钮画
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ theme })}
                  className={cx(
                    'flex cursor-pointer flex-col gap-2 rounded-[12px] border p-2 text-left',
                    on ? 'border-accent bg-accent-bg' : 'border-line bg-raised hover:bg-active',
                  )}
                >
                  <ThemePreview theme={theme} />
                  <span className="flex w-full items-center gap-1.5 px-0.5">
                    <span className="flex-1 font-medium">{t(`general.theme.${theme}`)}</span>
                    <span
                      className={cx(
                        'flex h-4 w-4 items-center justify-center rounded-full bg-accent text-raised',
                        !on && 'invisible',
                      )}
                    >
                      <Check size={11} strokeWidth={3} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 px-[18px] py-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{t('general.scale')}</span>
              <small className="text-[0.923rem] text-fg-muted">
                {t('general.scaleHint', {
                  px: g.uiScale === 's' ? 13 : g.uiScale === 'l' ? 15 : 14,
                })}
              </small>
            </div>
            <Segmented
              label={t('general.scale')}
              className="self-start"
              value={g.uiScale}
              onChange={(uiScale) => set({ uiScale })}
              options={[
                { value: 's', label: t('general.scale.s') },
                { value: 'm', label: t('general.scale.m') },
                { value: 'l', label: t('general.scale.l') },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{t('general.sidebar')}</span>
              <small className="text-[0.923rem] text-fg-muted">{t('general.sidebarHint')}</small>
            </div>
            <Segmented
              label={t('general.sidebar')}
              className="self-start"
              value={g.sidebar}
              onChange={(sidebar) => set({ sidebar })}
              options={[
                { value: 'expanded', label: t('general.sidebar.expanded') },
                { value: 'icons', label: t('general.sidebar.icons') },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card title={t('general.fonts')} hint={t('general.fontsHint')}>
        <div className="grid grid-cols-2 gap-4 px-[18px] pt-4 pb-3">
          <FontPicker
            label={t('general.uiFont')}
            value={g.uiFont}
            options={fonts.ui}
            fallback={t('general.uiFontDefault')}
            onChange={(uiFont) => set({ uiFont })}
          />
          <FontPicker
            label={t('general.codeFont')}
            value={g.codeFont}
            options={fonts.code}
            fallback={t('general.codeFontDefault')}
            mono
            onChange={(codeFont) => set({ codeFont })}
          />
          <div className="truncate rounded-[8px] bg-bg px-3 py-2">{t('general.uiSample')}</div>
          <div className="truncate rounded-[8px] bg-bg px-3 py-2 font-mono text-[length:var(--k-code-size)]">
            def redeem(user_id, request_id=None):
          </div>
        </div>
        <div className="flex items-center gap-3 px-[18px] pt-1 pb-4">
          <span className="font-medium">{t('general.codeSize')}</span>
          <small className="flex-1 text-[0.923rem] text-fg-muted">
            {t('general.codeSizeHint')}
          </small>
          <Segmented
            label={t('general.codeSize')}
            value={String(g.codeFontSize)}
            onChange={(v) => set({ codeFontSize: Number(v) })}
            options={['11', '12', '13', '14'].map((v) => ({ value: v, label: `${v} px` }))}
          />
        </div>
      </Card>

      <Card title={t('general.startupTitle')}>
        <Row label={t('general.language')} note={t('general.languageHint')}>
          <Segmented
            label={t('general.language')}
            value="zh"
            onChange={() => {}}
            options={[{ value: 'zh', label: '中文' }]}
          />
        </Row>
        <Row label={t('general.startup')} note={t('general.startupHint')}>
          <Segmented
            label={t('general.startup')}
            value={g.startup}
            onChange={(startup) => set({ startup })}
            options={[
              { value: 'last', label: t('general.startup.last') },
              { value: 'new', label: t('general.startup.new') },
            ]}
          />
        </Row>
        {(
          [
            ['notifyOnWait', 'general.notifyWait', 'general.notifyWaitHint'],
            ['notifyOnDone', 'general.notifyDone', 'general.notifyDoneHint'],
            ['keepRunning', 'general.keepRunning', 'general.keepRunningHint'],
          ] as const
        ).map(([key, label, note]) => (
          <Row key={key} label={t(label)} note={t(note)}>
            <Switch checked={g[key]} label={t(label)} onCheckedChange={(v) => set({ [key]: v })} />
          </Row>
        ))}
      </Card>

      <UpdateCard />

      <Card title={t('general.keys')} hint={t('general.keysHint')}>
        <div className="grid grid-cols-2 gap-x-6 px-[18px] pt-2 pb-3">
          {KEYS.map(([what, key]) => (
            <div
              key={what}
              className="flex items-center gap-2.5 border-line-soft border-b py-[7px] text-[0.962rem]"
            >
              <span className="flex-1 text-fg-muted">{t(what)}</span>
              <span className="rounded-[5px] bg-muted px-[7px] py-px font-mono text-[0.885rem]">
                {key}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// 版本与更新：没配更新地址时说明怎么配；配了能手动查一次
function UpdateCard() {
  const info = useAppInfo()
  const settings = useSettings()
  const [result, setResult] = useState<Awaited<ReturnType<typeof kits.app.checkForUpdates>>>()
  const [checking, setChecking] = useState(false)
  const url = settings.data?.updateUrl ?? ''
  const check = async () => {
    setChecking(true)
    try {
      setResult(await kits.app.checkForUpdates())
    } finally {
      setChecking(false)
    }
  }
  const text = !result
    ? url
      ? t('general.updateUrl', { url })
      : t('general.updateNoUrl')
    : result.status === 'available'
      ? t('general.updateAvailable', { version: result.version })
      : result.status === 'latest'
        ? t('general.updateLatest')
        : result.status === 'error'
          ? t('general.updateError', { message: result.message })
          : result.reason === 'dev'
            ? t('general.updateDev')
            : t('general.updateNoUrl')
  return (
    <Card title={t('general.update')}>
      <Row label={`kits ${info.data?.version ?? ''}`} note={text}>
        <Button disabled={checking} onClick={() => void check()}>
          {checking ? t('general.updateChecking') : t('general.updateCheck')}
        </Button>
      </Row>
    </Card>
  )
}
