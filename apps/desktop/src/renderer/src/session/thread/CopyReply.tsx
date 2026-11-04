import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { cx } from '../../ui/cx'
import { Tooltip } from '../../ui/Tooltip'

// 复制图标：点了变成对勾，1.5 秒后恢复。label 是平时的提示，也是读屏的名字
export function CopyIcon({
  text,
  label,
  className,
}: {
  text: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const hint = copied ? t('reply.copied') : label
  return (
    <Tooltip content={hint} side="top">
      <button
        type="button"
        aria-label={hint}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
        className={cx(
          'flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg',
          className,
          copied && 'opacity-100',
        )}
      >
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </Tooltip>
  )
}

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
