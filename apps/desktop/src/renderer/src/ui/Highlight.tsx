// 搜索结果的高亮：主进程把命中的部分夹在 \u0001 和 \u0002 之间
export function Highlight({ text }: { text: string }) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 标记就是这两个控制字符
  const pieces = text.split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <>
      {pieces.map((p, i) =>
        p.startsWith('\u0001') ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 片段按顺序切出来，不会重排
          <mark key={i} className="rounded-[3px] bg-mark px-px text-fg">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}
