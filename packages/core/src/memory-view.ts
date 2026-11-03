// 设置页 #skills 的记忆列表（phase1-implementation PR16）

export type MemoryScopeView = 'project' | 'personal'

export interface MemoryItem {
  // 在文件里第几条（改、删按它）
  index: number
  text: string
  // session：Agent 在会话里记的；manual：设置页手动加的；file：人在文件里手写的（没带来源注释）
  origin: 'session' | 'manual' | 'file'
  sessionTitle?: string
  // YYYY-MM-DD，手写的没有
  date: string
}

export interface MemoryOverview {
  path: string
  entries: MemoryItem[]
}
