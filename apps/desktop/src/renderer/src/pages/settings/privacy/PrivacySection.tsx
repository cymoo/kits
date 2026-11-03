import { t } from '../../../app/i18n'
import { kits, useAppInfo, useHomeLabel } from '../../../lib/kits'
import { Button } from '../../../ui/Button'

// 设置 · 数据与隐私（原型 settings.html#privacy 只有说明）：数据存在哪、记了什么、什么不出这台电脑。

function join(dir: string, ...parts: string[]): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return [dir.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

export function PrivacySection() {
  const info = useAppInfo()
  const homeLabel = useHomeLabel()
  const d = info.data
  const rows: [string, string, string][] = d
    ? [
        [t('privacy.config'), d.configDir, t('privacy.configNote')],
        [t('privacy.db'), join(d.userDataDir, 'kits.db'), t('privacy.dbNote')],
        [
          t('privacy.attachments'),
          join(d.userDataDir, 'attachments'),
          t('privacy.attachmentsNote'),
        ],
        [t('privacy.exports'), join(d.userDataDir, 'exports'), t('privacy.exportsNote')],
        [t('privacy.kernel'), join(d.userDataDir, 'kernel'), t('privacy.kernelNote')],
      ]
    : []
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
          {t('settings.privacy')}
        </h2>
        <p className="m-0 text-fg-muted">{t('privacy.intro')}</p>
      </div>
      <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised">
        <div className="flex items-baseline gap-2.5 border-line-soft border-b px-[18px] py-3">
          <b className="font-semibold">{t('privacy.where')}</b>
          <small className="text-[0.923rem] text-fg-muted">{t('privacy.whereHint')}</small>
        </div>
        {rows.map(([label, path, note]) => (
          <div
            key={label}
            className="flex items-center gap-3 border-line-soft border-b px-[18px] py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="font-medium">{label}</span>
              <span className="truncate font-mono text-[0.885rem] text-fg-muted" title={path}>
                {homeLabel(path)}
              </span>
              <span className="text-[0.885rem] text-fg-label">{note}</span>
            </span>
            <Button className="h-[26px] px-2" onClick={() => void kits.app.revealPath(path)}>
              {t('privacy.reveal')}
            </Button>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-raised px-[18px] py-3.5">
        <b className="font-semibold">{t('privacy.recorded')}</b>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-fg-muted leading-[1.6]">
          <li>{t('privacy.recorded.sessions')}</li>
          <li>{t('privacy.recorded.outputs')}</li>
          <li>{t('privacy.recorded.usage')}</li>
          <li>{t('privacy.recorded.permissions')}</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-raised px-[18px] py-3.5">
        <b className="font-semibold">{t('privacy.network')}</b>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-fg-muted leading-[1.6]">
          <li>{t('privacy.network.gateway')}</li>
          <li>{t('privacy.network.kernel')}</li>
          <li>{t('privacy.network.secrets')}</li>
        </ul>
      </section>
    </div>
  )
}
