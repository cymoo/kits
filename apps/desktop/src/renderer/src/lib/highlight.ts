import type { HighlighterCore, ThemedToken } from 'shiki/core'

// 文件预览的代码高亮。shiki 用 JS 正则引擎，不加载 wasm；语言按需加载，只打包这里列的。

const LANGS = {
  bash: () => import('shiki/dist/langs/bash.mjs'),
  c: () => import('shiki/dist/langs/c.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  csharp: () => import('shiki/dist/langs/csharp.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  diff: () => import('shiki/dist/langs/diff.mjs'),
  docker: () => import('shiki/dist/langs/docker.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  ini: () => import('shiki/dist/langs/ini.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  kotlin: () => import('shiki/dist/langs/kotlin.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  php: () => import('shiki/dist/langs/php.mjs'),
  powershell: () => import('shiki/dist/langs/powershell.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  toml: () => import('shiki/dist/langs/toml.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  xml: () => import('shiki/dist/langs/xml.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
}
export type Lang = keyof typeof LANGS

const BY_EXT: Record<string, Lang> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  diff: 'diff',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonl: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  patch: 'diff',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

export function languageOf(path: string): Lang | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === 'dockerfile') return 'docker'
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : BY_EXT[name.slice(dot + 1)]
}

let core: Promise<HighlighterCore> | undefined

async function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [
        import('shiki/dist/themes/github-light.mjs'),
        import('shiki/dist/themes/github-dark.mjs'),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  return core
}

// 每个 token 的 htmlStyle 里 color 是浅色值、--shiki-dark 是深色值，index.css 按主题选
export async function tokenize(code: string, lang: Lang): Promise<ThemedToken[][]> {
  const h = await highlighter()
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(LANGS[lang]())
  return h.codeToTokens(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
  }).tokens
}
