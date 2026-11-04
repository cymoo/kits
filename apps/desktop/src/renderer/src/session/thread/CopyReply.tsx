import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { cx } from '../../ui/cx'
import { Tooltip } from '../../ui/Tooltip'

// 回复下面的复制图标。复制的是 Markdown 原文；quiet 时靠外层的 group 悬浮才出现

export function CopyReply({ text, quiet }: { text: string; quiet: boolean }) {
  const [copied, setCopied] = useState(false)
  const label = t(copied ? 'reply.copied' : 'reply.copy')
  return (
    <div className="flex">
      <Tooltip content={label} side="top">
        <button
          type="button"
          aria-label={label}
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
          className={cx(
            '-ml-[5px] flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg',
            quiet && !copied && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          )}
        >
          {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
        </button>
      </Tooltip>
    </div>
  )
}
