import { z } from 'zod'

// 向用户提问。blocking 为 false 时 Agent 按假设继续，并在结果里注明。
export const askUserInputSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  assumption: z.string().optional(),
  blocking: z.boolean().default(false),
})
export type AskUserInput = z.infer<typeof askUserInputSchema>

export type AskUserResult =
  | { answered: true; answer: string }
  | { answered: false; assumption?: string }
