import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 回复正文：GFM（表格、任务列表、删除线）。链接交给系统浏览器（窗口不跳转）。代码高亮在 PR9 加。
export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  return (
    <div className={`k-md${caret ? ' k-md-caret' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
