import { Navigate, NavLink, useParams } from 'react-router'
import { type MessageKey, t } from '../../app/i18n'
import { useAppInfo, useSettingsLoadError } from '../../lib/kits'
import { cx } from '../../ui/cx'
import { ModelSection } from './model/ModelSection'
import { isSettingsSection, settingsSections } from './sections'

// 设置页外框（原型 settings.html）：左侧分区导航，底部版本和配置目录；各分区的内容在 PR5、PR12～14、PR17 做。
export function SettingsPage() {
  const { section } = useParams()
  const info = useAppInfo()
  const loadError = useSettingsLoadError()
  if (!isSettingsSection(section)) return <Navigate to="/settings/general" replace />
  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label={t('settings.title')}
        className="flex w-[200px] min-w-0 shrink-0 flex-col gap-px border-line border-r bg-bg px-2.5 pt-5 pb-5"
      >
        <h1 className="mt-0 mb-3 ml-2.5 font-semibold text-[1.154rem]">{t('settings.title')}</h1>
        {settingsSections.map((s) => (
          <NavLink
            key={s}
            to={`/settings/${s}`}
            className={({ isActive }) =>
              cx(
                'flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-fg no-underline hover:bg-active',
                isActive &&
                  'bg-raised font-medium shadow-[0_0_0_1px_var(--k-border)] hover:bg-raised',
              )
            }
          >
            {t(`settings.${s}` as MessageKey)}
          </NavLink>
        ))}
        <span className="flex-1" />
        <span
          className="break-all px-2.5 pt-1 text-[0.885rem] text-fg-label"
          data-testid="settings-footer"
        >
          {info.data
            ? t('settings.footer', { version: info.data.version, dir: info.data.configDir })
            : ''}
        </span>
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto px-10 pt-7 pb-12">
        {loadError.data ? (
          <div
            role="alert"
            className="mb-5 max-w-[720px] rounded-[10px] border border-danger/30 bg-danger-bg px-4 py-3 text-danger"
          >
            <p className="m-0">{t('settings.loadError')}</p>
            <p className="m-0 mt-1 break-all font-mono text-[0.923rem]">{loadError.data}</p>
          </div>
        ) : null}
        {section === 'model' ? (
          <ModelSection />
        ) : (
          <div className="flex max-w-[720px] flex-col gap-1">
            <h2 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
              {t(`settings.${section}` as MessageKey)}
            </h2>
            <p className="m-0 text-fg-muted">{t('settings.pending')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
