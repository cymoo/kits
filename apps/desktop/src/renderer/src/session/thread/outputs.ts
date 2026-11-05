import type { OutputView } from '@kits/core/ipc'
import type { Block } from './derive'

// 对话里的产出卡片放在这一轮的回复后面：步骤组和回复都在它上面。
export type OutputBlock = { kind: 'output'; id: string; output: OutputView }

export function placeOutputs(blocks: Block[], outputs: OutputView[]): (Block | OutputBlock)[] {
  const placed: (Block | OutputBlock)[] = [...blocks]
  for (const output of outputs) {
    const card: OutputBlock = { kind: 'output', id: `output:${output.id}`, output }
    const turn = placed.findLastIndex((b) => b.kind === 'turn' && b.turn === output.turn)
    if (turn < 0) {
      placed.push(card)
      continue
    }
    let at = turn + 1
    while (placed[at]?.kind === 'text' || placed[at]?.kind === 'output') at += 1
    placed.splice(at, 0, card)
  }
  return placed
}

// 结果里有几条：顶层是数组，或者对象里的第一个数组（findings 这种）。看不出来时不写
export function outputCount(content: unknown): number | undefined {
  if (Array.isArray(content)) return content.length
  if (content && typeof content === 'object') {
    const list = Object.values(content).find(Array.isArray)
    if (list) return list.length
  }
  return undefined
}
