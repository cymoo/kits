import { describe, expect, it } from 'vitest'
import { canOpenAttachment } from './attachment'

describe('canOpenAttachment', () => {
  it.each(['需求.docx', 'a.PDF', 'notes.md', 'shot.jpeg'])('opens %s', (name) => {
    expect(canOpenAttachment(name)).toBe(true)
  })

  it.each(['run.js', 'run.sh', 'run.py', 'run.bat', 'page.html', 'noext'])(
    'keeps %s out of the system apps',
    (name) => {
      expect(canOpenAttachment(name)).toBe(false)
    },
  )
})
