import { t } from '../../app/i18n'

// 会话页（原型 session.html）在 PR7 做。
export function SessionPage() {
  return <p className="m-10 text-fg-muted">{t('session.missing')}</p>
}
