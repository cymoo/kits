import { t } from '../../app/i18n'

// 首次引导（原型 onboarding.html）：网关在 PR5，工作目录和首次启动门控在 PR17，MCP 在 PR12。
export function OnboardingPage() {
  return <h1 className="m-10 font-semibold text-[1.538rem]">{t('onboarding.title')}</h1>
}
