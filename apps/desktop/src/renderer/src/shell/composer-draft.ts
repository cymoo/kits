// 发送要等一会儿，这期间输入框可能多了内容（退回的排队消息、接着打的字）：发完只去掉发出去的那段。
// 发出去的那段被改过就全留着，宁可重复也不丢
export function draftAfterSend(current: string, sent: string): string {
  const rest = current.trimStart()
  return rest.startsWith(sent) ? rest.slice(sent.length).trimStart() : current
}
