import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'

// 首页（原型 index.html）：标题、输入框。输入框的目录 / Agent / 权限 / 模型浮层和发送在 PR7 接，
// 建议和“继续上次”在 PR15。
export function HomePage() {
  const [text, setText] = useState('')
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-8">
      <div className="mt-[148px] mb-12 flex w-full max-w-[760px] flex-col gap-7">
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="m-0 font-semibold text-[2.154rem] tracking-[-0.015em]">
            {t('home.title')}
          </h1>
          <p className="m-0 text-fg-muted">{t('home.subtitle')}</p>
        </div>
        <div className="relative rounded-[16px] border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,.03),0_6px_20px_rgba(0,0,0,.05)] focus-within:border-line-strong">
          <label htmlFor="composer-home" className="sr-only">
            {t('composer.label')}
          </label>
          <textarea
            id="composer-home"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('home.placeholder')}
            className="block max-h-[220px] w-full resize-none border-0 bg-transparent px-[18px] pt-4 pb-2 text-[1.154rem] text-fg leading-[1.6] outline-none placeholder:text-fg-subtle"
          />
          <div className="flex items-center gap-0.5 px-2.5 pt-1.5 pb-2.5">
            <span className="flex-1" />
            <button
              type="button"
              aria-label="发送"
              disabled
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-primary text-primary-fg disabled:opacity-25"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
