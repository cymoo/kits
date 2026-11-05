import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { openPdf } from '../../lib/pdf'

// 一次画一页：翻页、改面板宽度时重画

export function PdfView({ data }: { data: Uint8Array }) {
  const [doc, setDoc] = useState<PDFDocumentProxy>()
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string>()
  const [width, setWidth] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let gone = false
    let opened: PDFDocumentProxy | undefined
    openPdf(data).then(
      (d) => {
        if (gone) void d.loadingTask.destroy()
        else {
          opened = d
          setDoc(d)
        }
      },
      (e) => {
        if (!gone) setError(errorText(e))
      },
    )
    return () => {
      gone = true
      void opened?.loadingTask.destroy()
    }
  }, [data])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const target = canvas.current
    if (!doc || !target || !width) return
    let gone = false
    let cancel: (() => void) | undefined
    void doc.getPage(page).then((p) => {
      if (gone) return
      const dpr = window.devicePixelRatio || 1
      const fit = Math.min(width - 32, 900) / p.getViewport({ scale: 1 }).width
      const viewport = p.getViewport({ scale: fit * dpr })
      target.width = viewport.width
      target.height = viewport.height
      target.style.width = `${viewport.width / dpr}px`
      target.style.height = `${viewport.height / dpr}px`
      const task = p.render({ canvas: target, viewport })
      cancel = () => task.cancel()
      // 翻页时取消上一次，它的报错不用管
      task.promise.catch(() => {})
    })
    return () => {
      gone = true
      cancel?.()
    }
  }, [doc, page, width])

  if (error) {
    return (
      <p className="m-0 p-6 text-center text-[0.929rem] text-danger">
        {t('files.readError', { error })}
      </p>
    )
  }
  const pages = doc?.numPages ?? 0
  const pager =
    'flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg disabled:cursor-default disabled:opacity-30'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-muted p-4">
        <canvas ref={canvas} data-testid="pdf-page" className="mx-auto block bg-white shadow-pop" />
      </div>
      {pages ? (
        <div className="flex h-9 shrink-0 items-center justify-center gap-2 border-line-soft border-t text-[0.929rem] text-fg-muted">
          <button
            type="button"
            aria-label={t('files.prevPage')}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className={pager}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">{t('files.page', { n: page, total: pages })}</span>
          <button
            type="button"
            aria-label={t('files.nextPage')}
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            className={pager}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
