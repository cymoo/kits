import { z } from 'zod'

// 记一条记忆：project 写 <工作目录>/.agents/memory.md，personal 写 ~/.kits/memory.md（phase1-implementation 3.5 节）。
export const rememberInputSchema = z.object({
  text: z.string().min(1).describe('一句话，下次会话还用得上的事实或约定'),
  scope: z
    .enum(['project', 'personal'])
    .default('project')
    .describe('project：只对当前工作目录有效；personal：对所有项目有效'),
})
export type RememberInput = z.infer<typeof rememberInputSchema>
