import { describe, expect, it } from 'vitest'
import { skillPrompt } from './skill'

describe('skillPrompt', () => {
  it('asks the agent to load an enabled skill before the rest of the message', () => {
    expect(skillPrompt('/test-plan 按需求出一份用例', ['test-plan'])).toBe(
      '使用技能 test-plan：先用 skill 工具加载它，再按里面的说明做。\n\n按需求出一份用例',
    )
    expect(skillPrompt('/explain', ['explain'])).toBe(
      '使用技能 explain：先用 skill 工具加载它，再按里面的说明做。',
    )
  })

  it('leaves other text and unknown or disabled skills alone', () => {
    expect(skillPrompt('/unknown 做点事', ['test-plan'])).toBe('/unknown 做点事')
    expect(skillPrompt('看下 /test-plan', ['test-plan'])).toBe('看下 /test-plan')
  })
})
