// 内核事件的统一格式（phase1 方案 4.1 节）。
// 两个内核的 SSE 事件都映射成这一种，界面和存储只认这一种。
// retry：内核到模型网关的请求断了、正在自动重试（PoC 里网关约 148 s 无输出会断连）。界面显示“重试中”，
// 带第几次、原因和下次重试的时间戳（毫秒），不然用户会以为卡死。

export type KernelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-start'; callId: string; name: string; input: unknown }
  | { type: 'tool-end'; callId: string; output: unknown; error?: string }
  | { type: 'permission-request'; requestId: string; tool: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'retry'; attempt: number; message: string; nextAt: number }
  | { type: 'done'; reason: DoneReason; error?: string }

export type DoneReason = 'completed' | 'aborted' | 'max-steps' | 'error'

export type PermissionDecision = 'allow' | 'deny'
