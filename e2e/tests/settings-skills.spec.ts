import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// 设置 · 技能（PR13）：内置 / 项目 / 个人三组、同名覆盖、开关写进 settings.json；输入框 / 菜单。

function skill(dir: string, name: string, description: string) {
  mkdirSync(path.join(dir, name), { recursive: true })
  writeFileSync(
    path.join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  )
}

function prepare(configDir: string) {
  const workdir = path.join(path.dirname(configDir), 'member-svc')
  mkdirSync(workdir, { recursive: true })
  skill(path.join(configDir, 'skills'), 'explain', '个人版的讲代码')
  skill(path.join(configDir, 'skills'), 'doc-zh', '给模块补中文文档')
  skill(path.join(workdir, '.agents', 'skills'), 'api-testing', '按接口文档生成接口测试')
  writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify({ workdirs: [{ path: realpathSync(workdir), lastUsedAt: 1 }] }),
  )
}

test('lists builtin, project and personal skills and turns one off', async () => {
  const { page, configDir, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    prepare(dir)
  })
  try {
    await page.goto(`${page.url().split('#')[0]}#/settings/skills`)
    const builtin = page.getByTestId('skills-builtin')
    await expect(builtin).toContainText('/code-review')
    await expect(builtin).toContainText('/test-plan')
    // 个人的 explain 覆盖了内置的
    await expect(builtin).toContainText('同名，个人的优先')
    await expect(page.getByTestId('skills-personal')).toContainText('覆盖了内置的同名技能')
    await expect(page.getByTestId('skills-project')).toContainText('/api-testing')
    await page.screenshot({ path: 'test-results/settings-skills.png' })

    await page.getByRole('switch', { name: '启用 /doc-zh' }).click()
    await expect(page.getByRole('switch', { name: '启用 /doc-zh' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8')).skillsDisabled,
      )
      .toEqual(['doc-zh'])
  } finally {
    await close()
  }
})

test('fills a skill from the / menu of the composer', async () => {
  const { page, close } = await launchApp({}, (dir) => {
    mkdirSync(dir, { recursive: true })
    prepare(dir)
  })
  try {
    await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
    const box = page.getByLabel('给 Agent 发消息')
    await box.click()
    await box.pressSequentially('/')
    const menu = page.getByTestId('slash-menu')
    await expect(menu).toContainText('/api-testing')
    await expect(menu).toContainText('/code-review')
    await box.pressSequentially('test-')
    await expect(menu.getByRole('option')).toHaveText([/test-plan/])
    await box.press('Enter')
    await expect(menu).toBeHidden()
    await expect(box).toHaveValue('/test-plan ')
  } finally {
    await close()
  }
})
