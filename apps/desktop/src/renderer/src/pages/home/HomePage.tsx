import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { basename, resolvePrefs, usePrefs } from '../../lib/composer-prefs'
import { kits, useSettings } from '../../lib/kits'
import { Composer } from '../../shell/Composer'

// 首页（原型 index.html）：标题、输入框，发送后新建会话进入会话页。建议和“继续上次”在 PR15。
export function HomePage() {
  const navigate = useNavigate()
  const settings = useSettings()
  const prefs = usePrefs()
  const workdir = resolvePrefs(prefs, settings.data).workdir
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-8">
      <div className="mt-[148px] mb-12 flex w-full max-w-[760px] flex-col gap-7">
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="m-0 font-semibold text-[2.154rem] tracking-[-0.015em]">
            {t('home.title')}
          </h1>
          <p className="m-0 text-fg-muted">
            {workdir ? (
              <>
                在 <span className="font-mono text-[0.923rem] text-fg">{basename(workdir)}</span>{' '}
                里干活。
              </>
            ) : null}
            {t('home.subtitle')}
          </p>
        </div>
        <Composer
          big
          placeholder={t('home.placeholder')}
          onSubmit={async (input) => {
            const session = await kits.session.create(input)
            navigate(`/s/${session.id}`)
          }}
        />
      </div>
    </div>
  )
}
