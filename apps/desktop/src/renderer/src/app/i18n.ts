// 界面文案集中在这一张表（phase1-implementation 6.1 节）。第一版只有中文，以后加语言只加表，不改页面。
// 键按页面分组；{name} 是占位，t('palette.newWith', { q }) 这样传。

const zhCN = {
  'app.name': 'kits',
  'nav.label': '主导航',
  'nav.collapse': '折叠或展开侧栏',
  'nav.new': '新会话',
  'nav.search': '搜索',
  'nav.settings': '设置',
  'nav.empty': '还没有会话',
  'home.title': '要做什么？',
  'home.subtitle': '输入 / 用命令，@ 引用文件、需求或用例。',
  'home.placeholder': '描述任务。例如：给积分兑换接口加幂等校验，改完跑 tests/points 下的测试',
  'composer.label': '给 Agent 发消息',
  'palette.label': '搜索和跳转',
  'palette.placeholder': '搜会话、跳到设置、切换目录…',
  'palette.sessions': '会话',
  'palette.noSessions': '还没有会话',
  'palette.actions': '动作',
  'palette.new': '新会话',
  'palette.newWith': '新会话：“{q}”',
  'palette.history': '全部会话',
  'palette.settings': '设置 · {section}',
  'palette.footSelect': '↑↓ 选择',
  'palette.footOpen': '↵ 打开',
  'palette.footLocal': '搜索只在本机进行',
  'palette.noMatch': '没有匹配“{q}”的动作',
  'settings.title': '设置',
  'settings.general': '通用',
  'settings.model': '内核与模型',
  'settings.mcp': 'MCP 服务',
  'settings.skills': '技能与记忆',
  'settings.agent': 'Agent',
  'settings.perm': '权限',
  'settings.privacy': '数据与隐私',
  'settings.footer': 'kits {version} · 配置文件在 {dir}',
  'settings.loadError': '设置文件读不了，先用默认值。保存时会把原文件备份一份。',
  'settings.pending': '这一页还在做。',
  'history.title': '全部会话',
  'history.empty': '还没有会话。到首页输入任务开始第一个。',
  'session.missing': '没有找到这个会话。',
  'onboarding.title': '开始使用 kits',
  'common.esc': 'Esc',
} as const

export type MessageKey = keyof typeof zhCN

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text: string = zhCN[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}
