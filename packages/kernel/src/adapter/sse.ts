// text/event-stream 的最小解析：只关心 data 字段，空行分隔一条事件，多行 data 用换行拼起来。
// 两个内核的事件流都只用 data（JSON），event / id / retry 字段忽略。

export function createSseParser(onData: (data: string) => void): (chunk: string) => void {
  let buffer = ''
  let data: string[] = []
  return (chunk) => {
    buffer += chunk
    // CRLF 可能被切在两块之间：结尾的 \r 先不当换行，等下一块看后面是不是 \n
    const held = buffer.endsWith('\r') ? '\r' : ''
    const lines = (held ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/)
    // 最后一段可能是半行，留到下次
    buffer = (lines.pop() ?? '') + held
    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) onData(data.join('\n'))
        data = []
      } else if (line.startsWith('data:')) {
        data.push(line.slice(line.startsWith('data: ') ? 6 : 5))
      }
      // 以 : 开头的是注释（心跳），其他字段不用
    }
  }
}

// 读一个 SSE 响应体，逐条产出解析好的 JSON；解析不了的行跳过。
export async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const queue: unknown[] = []
  const parse = createSseParser((data) => {
    try {
      queue.push(JSON.parse(data))
    } catch {
      // 不是 JSON 的事件不认
    }
  })
  const decoder = new TextDecoder()
  const reader = body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      parse(decoder.decode(value, { stream: true }))
      while (queue.length > 0) yield queue.shift()
    }
  } finally {
    reader.releaseLock()
  }
}
