import { canOpenAttachment } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { kits } from '../../lib/kits'
import { DialogClose } from '../../ui/Dialog'
import { Segmented } from '../../ui/Segmented'
import { Spinner } from '../../ui/Spinner'
import { FileBody, isMarkdownFile } from '../panels/FileBody'

const TOOL =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40'

// 附件预览弹窗的内容。消息下面点文件名打开，内容和文件页签的预览一样
export function AttachmentPreview({ id, name }: { id: string; name: string }) {
  const preview = useQuery({
    queryKey: ['attachment-preview', id],
    queryFn: () => kits.session.attachmentPreview(id),
    // PDF、Word 可能有 20 MB，弹窗关了就不留
    gcTime: 0,
  })
  const [source, setSource] = useState(false)
  const [openError, setOpenError] = useState<string>()
  const data = preview.data
  const openLabel = t(canOpenAttachment(name) ? 'files.open' : 'changes.reveal')
  const OpenIcon = canOpenAttachment(name) ? ExternalLink : FolderOpen
  const open = () => {
    setOpenError(undefined)
    kits.session.attachmentOpen(id).catch((e) => setOpenError(errorText(e)))
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="attachment-preview">
      <div className="flex min-h-11 shrink-0 items-center gap-1 border-line-soft border-b py-1 pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate font-medium" title={name}>
          {name}
        </span>
        {isMarkdownFile(name) && data?.kind === 'text' ? (
          <Segmented
            label={t('panel.view')}
            value={source ? 'source' : 'rendered'}
            onChange={(v) => setSource(v === 'source')}
            options={[
              { value: 'rendered', label: t('files.rendered') },
              { value: 'source', label: t('files.source') },
            ]}
          />
        ) : null}
        {data ? (
          <button
            type="button"
            aria-label={openLabel}
            title={openLabel}
            onClick={open}
            className={TOOL}
          >
            <OpenIcon size={14} />
          </button>
        ) : null}
        <DialogClose aria-label={t('common.close')} title={t('common.close')} className={TOOL}>
          <X size={15} />
        </DialogClose>
      </div>
      {openError ? (
        <p className="m-0 shrink-0 border-line-soft border-b bg-danger-bg/60 px-4 py-1.5 text-[0.929rem] text-danger">
          {openError}
        </p>
      ) : null}
      {data?.kind === 'text' && data.truncated ? (
        <p className="m-0 shrink-0 border-line-soft border-b bg-warn-soft px-4 py-1.5 text-[0.929rem] text-warn-strong">
          {t('files.truncated')}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.isPending ? (
          <div className="flex h-full items-center justify-center">
            <Spinner tone="accent" />
          </div>
        ) : null}
        {preview.isError ? (
          <p className="m-0 p-6 text-center text-[0.929rem] text-danger">
            {t('files.readError', { error: errorText(preview.error) })}
          </p>
        ) : null}
        {data === null ? (
          <p className="m-0 p-6 text-center text-[0.929rem] text-fg-muted">
            {t('session.attachmentGone')}
          </p>
        ) : null}
        {data ? (
          <FileBody
            name={name}
            preview={data}
            source={source}
            openLabel={openLabel}
            onOpen={open}
          />
        ) : null}
      </div>
    </div>
  )
}
