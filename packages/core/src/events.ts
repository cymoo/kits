// 内核事件的统一格式（phase1 方案 4.1 节，phase1-implementation 4.2 节）。
// 两个内核的 SSE 事件都映射成这一种，界面和存储只认这一种。
// - text-delta / reasoning-delta 带 partId：同一个 part 的增量合并到一处落库。
// - retry：内核到模型网关的请求断了、正在自动重试（PoC 里网关约 148 s 无输出会断连）。界面显示“重试中”，
//   带第几次、原因和下次重试的时间戳（毫秒），不然用户会以为卡死。
// - status：内核报告的会话状态，界面用 busy 且一段时间没有新 part 来显示“正在…”。
// - usage：一轮 LLM 调用一条；inputTokens 含缓存命中和写入，cache 两项单列方便算成本。

export type KernelEvent =
  | { type: 'text-delta'; partId: string; text: string }
  | { type: 'reasoning-delta'; partId: string; text: string }
  // parentCallId：子任务里的工具，值是派它的 task 工具的 callId
  | { type: 'tool-start'; callId: string; name: string; input: unknown; parentCallId?: string }
  | {
      type: 'tool-end'
      callId: string
      output: unknown
      error?: string
      title?: string
      // 命令的退出码（bash）和工具耗时，内核给了才有
      exitCode?: number
      durationMs?: number
      // 这一步改了多少行（edit）；count 是搜到几处（grep、glob）或文件有几行（read）。都是内核给了才有
      additions?: number
      deletions?: number
      count?: number
    }
  | {
      type: 'permission-request'
      requestId: string
      tool: string
      input: unknown
      // 这次请求匹配的模式（bash 是命令本身）和“本会话允许”会记住的模式
      patterns: string[]
      always: string[]
      // 关联到 tool-start 的 callId，内核没给时为空
      callId?: string
      // 子任务（内核的子会话）发起的。子会话不继承主会话的放行规则，由 SessionService 按主会话的规则判断
      subagent?: boolean
    }
  | {
      // 内核回复了权限请求。用户回复别的请求时，内核会连带处理同一会话里的其他请求：
      // 拒绝一个就全拒绝，“本会话允许”覆盖到的也一起放行
      type: 'permission-replied'
      requestId: string
      reply: PermissionReply
    }
  | {
      type: 'usage'
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      cost: number
    }
  | { type: 'retry'; attempt: number; message: string; nextAt: number }
  | { type: 'status'; state: SessionState }
  | { type: 'compaction'; summary: string }
  | { type: 'done'; reason: DoneReason; error?: string }

export type SessionState = 'busy' | 'idle' | 'retry'

export type DoneReason = 'completed' | 'aborted' | 'max-steps' | 'error'

// 权限回复：允许一次 / 本会话允许 / 拒绝。拒绝可以带说明，内核把它作为反馈交给模型
export type PermissionReply = 'once' | 'always' | 'reject'
