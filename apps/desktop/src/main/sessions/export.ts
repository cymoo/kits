import type { MessageView, PartView, SessionDetail } from '@kits/core'

// 导出整个会话：对话读起来是一篇 Markdown，工具调用只留一行；要原始数据用 JSON。

const NOTICE: Record<string, string> = { permission: '权限改为', model: '模型切换到' }

function toolLine(
  p: Extract<PartView['payload'], { type: 'tool' }>,
  status: string | null,
): string {
  const failed = status === 'error' ? '（失败）' : ''
  return `- \`${p.name}\`${failed}`
}

function assistantText(parts: PartView[]): string {
  const lines: string[] = []
  // 连续的工具调用列在一起，正文之间空一行
  let tools = false
  for (const part of parts) {
    const p = part.payload
    if (p.type === 'tool') {
      if (!tools && lines.length) lines.push('')
      lines.push(toolLine(p, part.status))
      tools = true
    } else if (p.type === 'text' && p.text.trim()) {
      if (lines.length) lines.push('')
      lines.push(p.text.trim())
      tools = false
    } else if (p.type === 'compaction' && p.summary) {
      if (lines.length) lines.push('')
      lines.push(`> 前面的对话已压缩成摘要：\n>\n> ${p.summary.replace(/\n/g, '\n> ')}`)
      tools = false
    }
  }
  return lines.join('\n')
}

function noticeText(m: MessageView): string {
  const at = m.text.indexOf(':')
  return `> ${NOTICE[m.text.slice(0, at)] ?? ''} ${m.text.slice(at + 1)}`
}

export function sessionMarkdown({ session, messages, parts }: SessionDetail): string {
  const out = [
    `# ${session.title}`,
    '',
    `工作区 \`${session.workdir}\` · Agent ${session.agent} · 模型 ${session.model}`,
  ]
  const ordered = [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || (a.role === 'user' ? -1 : 1),
  )
  for (const m of ordered) {
    if (m.role === 'user') out.push('', '## 你', '', m.text)
    else if (m.role === 'notice') out.push('', noticeText(m))
    else {
      const body = assistantText(
        parts.filter((p) => p.messageId === m.id).sort((a, b) => a.seq - b.seq),
      )
      if (body) out.push('', '## Agent', '', body)
    }
  }
  return `${out.join('\n')}\n`
}
