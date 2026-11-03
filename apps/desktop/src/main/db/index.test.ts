import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './index'
import { sessions } from './schema'

const migrations = path.resolve(import.meta.dirname, '../../../drizzle')

describe('openDatabase', () => {
  it('migrates an empty database and round-trips a session', () => {
    const { db, close } = openDatabase(':memory:', migrations)
    const createdAt = new Date(1_700_000_000_000)
    db.insert(sessions)
      .values({
        id: 's1',
        title: 't',
        agent: 'assistant',
        kernel: 'opencode',
        workdir: '/w',
        createdAt,
      })
      .run()
    const rows = db.select().from(sessions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.createdAt.getTime()).toBe(createdAt.getTime())
    close()
  })
})
