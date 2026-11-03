import { Link, useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { basename, resolvePrefs, usePrefs } from '../../lib/composer-prefs'
import { kits, useSettings } from '../../lib/kits'
import { continueCards, stateOf, TONE, whenLabel } from '../../lib/session-labels'
import { useSessions } from '../../lib/sessions'
import { useUi } from '../../lib/ui-store'
import { useNow } from '../../lib/use-now'
import { Composer } from '../../shell/Composer'
import { StatusDot } from '../../shell/SessionList'
import { cx } from '../../ui/cx'

// 首页（原型 index.html）：标题、输入框、四条建议（点了填进输入框）、“继续上次”三张卡（等人处理的排前面）。

// 芯片上显示短的，点了填进去完整的一句
const SUGGESTIONS: [kind: string, label: string, text: string][] = [
  [
    '写用例',
    '按需求文档整理测试用例',
    '按 docs/ 下的需求文档整理一份测试用例，覆盖正常、边界和异常',
  ],
  ['排查', '最近跑挂的测试为什么失败', '最近一次跑挂的测试为什么失败，找到原因并给出修复建议'],
  ['补测试', '给改动的模块补单元测试', '给改动最多的模块补单元测试，跑一遍并报告覆盖到了哪些分支'],
  ['问答', '这个仓库的测试怎么跑', '这个仓库的测试怎么跑、目录怎么组织，指出对应的配置'],
]

export function HomePage() {
  const navigate = useNavigate()
  const settings = useSettings()
  const prefs = usePrefs()
  const fillHome = useUi((s) => s.fillHome)
  const sessions = useSessions()
  const now = useNow(60_000)
  const workdir = resolvePrefs(prefs, settings.data).workdir
  const recent = continueCards(sessions.data ?? [])
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
        <div className="flex flex-wrap justify-center gap-2" data-testid="suggestions">
          {SUGGESTIONS.map(([kind, label, text]) => (
            <button
              key={kind}
              type="button"
              onClick={() => fillHome(text)}
              title={text}
              className="inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-2xl border border-line bg-transparent px-3 text-[0.962rem] text-fg-muted hover:border-line-strong hover:bg-raised hover:text-fg"
            >
              <span className="text-fg-subtle">{kind}</span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {recent.length ? (
          <section className="mt-4 flex flex-col gap-2" aria-labelledby="home-continue">
            <div className="flex items-baseline gap-2 px-1">
              <h2 id="home-continue" className="m-0 font-medium text-[0.923rem] text-fg-label">
                {t('home.continue')}
              </h2>
              <span className="flex-1" />
              <Link
                to="/history"
                className="text-[0.923rem] text-accent no-underline hover:text-accent-fg"
              >
                {t('home.allSessions')}
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2" data-testid="continue-cards">
              {recent.map((s) => {
                const state = stateOf(s.status)
                return (
                  <Link
                    key={s.id}
                    to={`/s/${s.id}`}
                    className="flex min-h-[92px] flex-col gap-2 rounded-[12px] px-3.5 py-3 text-fg no-underline hover:bg-raised hover:shadow-[0_0_0_1px_var(--k-border)]"
                  >
                    <span
                      className={cx(
                        'flex items-center gap-1.5 font-medium text-[0.885rem]',
                        TONE[state.tone],
                      )}
                    >
                      <StatusDot status={s.status} />
                      {s.status === 'waiting' ? t('home.waiting') : state.label}
                    </span>
                    <span className="line-clamp-2 font-medium leading-[1.4]">{s.title}</span>
                    <span className="mt-auto truncate text-[0.923rem] text-fg-muted">
                      {basename(s.workdir)} · {whenLabel(s.updatedAt, now)}
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
