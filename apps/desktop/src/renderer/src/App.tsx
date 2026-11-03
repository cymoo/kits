import { useEffect, useState } from 'react'

// 空壳：侧栏 + 首页的输入框，照 designs/app/index.html 的布局。功能按模块往里填。

export function App() {
  const [pong, setPong] = useState<string>('…')

  useEffect(() => {
    window.kits
      .ping()
      .then((r) => setPong(`${r.os} · electron ${window.kits.versions.electron}`))
      .catch((e: unknown) => setPong(String(e)))
  }, [])

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-neutral-200 border-r bg-neutral-50 pt-10">
        <div className="px-3 font-semibold text-sm">kits</div>
        <nav className="mt-4 flex flex-col gap-1 px-2 text-neutral-700 text-sm">
          <span className="rounded px-2 py-1">新对话</span>
          <span className="rounded px-2 py-1">搜索</span>
        </nav>
        <div className="mt-auto px-3 py-3 text-neutral-500 text-xs" data-testid="ping">
          {pong}
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <h1 className="font-semibold text-2xl">要做什么？</h1>
        <textarea
          className="w-full max-w-2xl resize-none rounded-xl border border-neutral-200 p-4 text-sm shadow-sm outline-none focus:border-neutral-400"
          rows={3}
          placeholder="描述任务，@ 引用需求，或拖进文件"
        />
      </main>
    </div>
  )
}
