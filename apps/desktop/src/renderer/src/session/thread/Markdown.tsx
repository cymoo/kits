import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 回复正文：GFM（表格、任务列表、删除线）。链接交给系统浏览器（窗口不跳转）。代码高亮在 PR9 加。
// 按 text 和 caret 记忆化：流式时每 50 ms 一批，历史回复没变就不重新解析
export const Markdown = memo(function Markdown({
  text,
  caret = false,
}: {
  text: string
  caret?: boolean
}) {
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
          // 宽表格在自己的框里横向滚动：对话里的块会裁掉超出边界的内容（index.css 的 k-thread-item）
          table: ({ children }) => (
            <div className="k-md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
