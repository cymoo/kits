import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { basename, resolvePrefs, usePrefs } from '../../lib/composer-prefs'
import { kits, useSettings } from '../../lib/kits'
import { useUi } from '../../lib/ui-store'
import { Composer } from '../../shell/Composer'

// 首页（原型 index.html）：标题、输入框、四条建议（点了填进输入框）。最近的会话看侧栏。

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
  const workdir = resolvePrefs(prefs, settings.data).workdir
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-8">
      <div className="my-auto flex w-full max-w-[760px] flex-col gap-7 pt-12 pb-[12vh]">
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="m-0 font-semibold text-[2.143rem] tracking-[-0.015em]">
            {t('home.title')}
          </h1>
          <p className="m-0 text-fg-muted">
            {workdir ? (
              <>
                在 <span className="font-mono text-[0.929rem] text-fg">{basename(workdir)}</span>{' '}
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
              className="inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-2xl border border-line bg-transparent px-3 text-[0.929rem] text-fg-muted hover:border-line-strong hover:bg-raised hover:text-fg"
            >
              <span className="text-fg-subtle">{kind}</span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
