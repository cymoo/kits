import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  attachmentKind,
  extractText,
  imageMime,
  isImage,
  MAX_CHARS,
  UnsupportedAttachmentError,
} from './extract'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)))

describe('extractText', () => {
  it('reads the paragraphs of a Word document', async () => {
    const text = await extractText('需求.docx', '', fixture('requirement.docx'))
    expect(text).toContain('积分兑换需求')
    expect(text).toContain('同一个请求号只兑换一次。')
  })

  it('reads the text of every PDF page', async () => {
    const text = await extractText('spec.pdf', 'application/pdf', fixture('spec.pdf'))
    expect(text).toContain('Refund API spec')
    expect(text).toContain('request_id is required')
  })

  it('reads markdown and code as utf-8', async () => {
    const data = new TextEncoder().encode('# 用例\r\n- 正常兑换\r\n')
    expect(await extractText('cases.md', 'text/markdown', data)).toBe('# 用例\n- 正常兑换')
  })

  it('cuts an attachment longer than the limit and says how much is left out', async () => {
    const data = new TextEncoder().encode('字'.repeat(MAX_CHARS + 10))
    const text = await extractText('big.txt', 'text/plain', data)
    expect(text.startsWith('字'.repeat(MAX_CHARS))).toBe(true)
    expect(text).toContain('后面还有 10 字没放进来')
  })

  it('names the file when a document cannot be parsed', async () => {
    await expect(
      extractText('坏的.docx', '', new TextEncoder().encode('not a zip')),
    ).rejects.toThrow('坏的.docx：读不了')
  })

  it('refuses images and other binary files', async () => {
    expect(attachmentKind('shot.png', 'image/png')).toBeUndefined()
    await expect(extractText('shot.png', 'image/png', new Uint8Array([1]))).rejects.toBeInstanceOf(
      UnsupportedAttachmentError,
    )
  })
})

describe('imageMime', () => {
  it.each([
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ])('recognises %s from the file header', (mime, bytes) => {
    expect(imageMime(new Uint8Array(bytes))).toBe(mime)
  })

  it('does not take other files for images', () => {
    expect(imageMime(new TextEncoder().encode('hello'))).toBeUndefined()
    expect(imageMime(new Uint8Array())).toBeUndefined()
  })
})

describe('isImage', () => {
  it('goes by the extension or the type', () => {
    expect(isImage('shot.PNG', '')).toBe(true)
    expect(isImage('clipboard', 'image/webp')).toBe(true)
    expect(isImage('notes.txt', 'text/plain')).toBe(false)
    expect(isImage('logo.svg', 'image/svg+xml')).toBe(false)
  })
})
