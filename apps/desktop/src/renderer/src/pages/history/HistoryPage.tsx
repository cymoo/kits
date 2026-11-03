import { t } from '../../app/i18n'

// 会话历史（原型 history.html）：筛选、分组在 PR15 做，这里先是空状态。
export function HistoryPage() {
  return (
    <div className="flex-1 overflow-y-auto px-10 pt-7">
      <h1 className="m-0 font-semibold text-[1.538rem]">{t('history.title')}</h1>
      <p className="mt-3 text-fg-muted">{t('history.empty')}</p>
    </div>
  )
}
