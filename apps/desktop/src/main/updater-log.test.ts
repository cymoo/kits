import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUpdateLog } from './updater-log'

describe('createUpdateLog', () => {
  let dir: string
  const at = () => new Date('2026-11-07T08:00:00.000Z')

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kits-update-log-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends one timestamped line per entry and creates the folder', () => {
    const file = path.join(dir, 'logs', 'updater.log')
    const log = createUpdateLog(file, at)
    log('info', 'checking http://ci/kits')
    log('error', 'update failed: 404')
    expect(readFileSync(file, 'utf8')).toBe(
      '2026-11-07T08:00:00.000Z info checking http://ci/kits\n2026-11-07T08:00:00.000Z error update failed: 404\n',
    )
  })

  it('moves a log over 1 MB aside before writing', () => {
    const file = path.join(dir, 'updater.log')
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 1))
    createUpdateLog(file, at)('info', 'fresh')
    expect(existsSync(`${file}.old`)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('2026-11-07T08:00:00.000Z info fresh\n')
  })

  it('stops quietly when the log cannot be written', () => {
    const blocker = path.join(dir, 'not-a-dir')
    writeFileSync(blocker, '')
    const log = createUpdateLog(path.join(blocker, 'updater.log'), at)
    expect(() => log('info', 'a')).not.toThrow()
    expect(() => log('info', 'b')).not.toThrow()
  })
})
