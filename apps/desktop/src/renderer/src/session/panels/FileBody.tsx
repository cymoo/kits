import type { FilePreview } from '@kits/core/ipc'
import { useEffect, useMemo, useState } from 'react'
import type { ThemedToken } from 'shiki/core'
import { t } from '../../app/i18n'
import { CSV_ROWS, parseTable } from '../../lib/csv'
import { languageOf, tokenize } from '../../lib/highlight'
import { Button } from '../../ui/Button'
import { Markdown } from '../thread/Markdown'
import { PdfView } from './PdfView'

// 文件内容的预览：文件页签和附件弹窗共用。只管内容，工具栏和滚动容器在外面。

// 高亮和行号都按行渲染：太长的文件退回纯文本，不卡界面
const HIGHLIGHT_LINES = 5_000
const HIGHLIGHT_CHARS = 300_000
const NUMBERED_LINES = 20_000

const DOC_STYLE =
  'body{margin:0 auto;max-width:720px;padding:20px 24px 32px;color:#16171a;font:14px/24px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}table{border-collapse:collapse}td,th{border:1px solid #e8e8e5;padding:5px 10px}img{max-width:100%}'

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export function isMarkdownFile(name: string): boolean {
  const ext = extOf(name)
  return ext === 'md' || ext === 'markdown'
}

function CodeView({ path, text }: { path: string; text: string }) {
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text])
  const lang = languageOf(path)
  const [tokens, setTokens] = useState<ThemedToken[][]>()
  const canHighlight = !!lang && lines.length <= HIGHLIGHT_LINES && text.length <= HIGHLIGHT_CHARS
  useEffect(() => {
    setTokens(undefined)
    if (!canHighlight || !lang) return
    let gone = false
    // 高亮失败时留着纯文本
    void tokenize(text, lang).then(
      (t) => {
        if (!gone) setTokens(t)
      },
      () => {},
    )
    return () => {
      gone = true
    }
  }, [text, lang, canHighlight])
  if (lines.length > NUMBERED_LINES) {
    return (
      <pre data-testid="file-code" className="k-src m-0 px-4 py-3">
        {text}
      </pre>
    )
  }
  return (
    <pre data-testid="file-code" className="k-src m-0 min-w-fit py-3">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行号就是这一行的身份
        <span key={i} className="k-src-line">
          <span aria-hidden="true" className="k-src-no">
            {i + 1}
          </span>
          {tokens?.[i]
            ? tokens[i].map((token, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同一行的 token 不会重排
                <span key={j} style={token.htmlStyle as React.CSSProperties}>
                  {token.content}
                </span>
              ))
            : line}
        </span>
      ))}
    </pre>
  )
}

function TableView({ text, sep }: { text: string; sep: ',' | '\t' }) {
  const rows = useMemo(() => parseTable(text, sep), [text, sep])
  const [head, ...body] = rows
  return (
    <>
      <table data-testid="file-table" className="k-sheet">
        <thead>
          <tr>
            {head?.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 表头可能重名，按列位置
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 只读表格，行不会重排
            <tr key={i}>
              {r.map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= CSV_ROWS ? (
        <p className="m-0 px-3 py-2 text-[0.929rem] text-fg-label">
          {t('files.rowLimit', { n: CSV_ROWS })}
        </p>
      ) : null}
    </>
  )
}

function Blocked({
  preview,
  openLabel,
  onOpen,
}: {
  preview: Extract<FilePreview, { kind: 'unsupported' }>
  openLabel: string
  onOpen(): void
}) {
  const large = preview.reason === 'large'
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
      <span className="font-medium text-fg">
        {t(large ? 'files.tooLarge' : 'files.unsupported')}
      </span>
      <span className="max-w-[260px] text-[0.929rem]">
        {t(large ? 'files.tooLargeNote' : 'files.unsupportedNote')}
      </span>
      <Button className="mt-1 h-[30px] px-3 text-[0.929rem]" onClick={onOpen}>
        {openLabel}
      </Button>
    </div>
  )
}

export function FileBody({
  name,
  preview,
  source,
  openLabel = t('files.open'),
  onOpen,
}: {
  name: string
  preview: FilePreview
  // Markdown 看源码还是渲染后的样子
  source: boolean
  openLabel?: string
  onOpen(): void
}) {
  const ext = extOf(name)
  if (preview.kind === 'unsupported') {
    return <Blocked preview={preview} openLabel={openLabel} onOpen={onOpen} />
  }
  if (preview.kind === 'image') {
    return (
      <div className="flex justify-center p-4">
        <img src={preview.dataUrl} alt={name} className="max-w-full" />
      </div>
    )
  }
  if (preview.kind === 'pdf') return <PdfView data={preview.data} />
  if (preview.kind === 'html') {
    return (
      // 文档内容不可信：空的 sandbox 不让脚本跑、不让跳转
      <iframe
        title={name}
        sandbox=""
        srcDoc={`<!doctype html><meta charset="utf-8"><style>${DOC_STYLE}</style>${preview.html}`}
        className="block h-full w-full border-0 bg-white"
      />
    )
  }
  if (isMarkdownFile(name) && !source) {
    return (
      <div className="mx-auto max-w-[720px] px-6 pt-5 pb-8">
        <Markdown text={preview.text} />
      </div>
    )
  }
  if (ext === 'csv' || ext === 'tsv') {
    return <TableView text={preview.text} sep={ext === 'csv' ? ',' : '\t'} />
  }
  return <CodeView path={name} text={preview.text} />
}
