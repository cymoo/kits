import { describe, expect, it } from 'vitest'
import { pastedFiles, transferredFiles } from './composer-files'

const file = (name: string, type = '') => new File(['x'], name, { type })

// 只造用到的字段：单测在 Node 里跑，没有 DataTransfer
function transfer(entries: { file?: File; folder?: boolean }[], text = '') {
  const items = entries.map((e) => ({
    kind: e.file ? 'file' : 'string',
    getAsFile: () => e.file ?? null,
    webkitGetAsEntry: () => (e.folder ? { isDirectory: true } : null),
  }))
  return {
    items: items as unknown as DataTransferItemList,
    getData: () => text,
  }
}

describe('transferredFiles', () => {
  it('keeps every file in order', () => {
    const a = file('a.pdf')
    const b = file('b.md')
    expect(transferredFiles(transfer([{ file: a }, { file: b }]))).toEqual({
      files: [a, b],
      folders: [],
    })
  })

  it('separates folders from files', () => {
    const a = file('a.pdf')
    expect(transferredFiles(transfer([{ file: a }, { file: file('docs'), folder: true }]))).toEqual(
      { files: [a], folders: ['docs'] },
    )
  })

  it('skips items that are not files', () => {
    expect(transferredFiles(transfer([{}])).files).toEqual([])
  })
})

describe('pastedFiles', () => {
  it('takes a pasted document', () => {
    const doc = file('a.pdf', 'application/pdf')
    expect(pastedFiles(transfer([{ file: doc }])).files).toEqual([doc])
  })

  it('takes a pasted image when there is no text', () => {
    const image = file('image.png', 'image/png')
    expect(pastedFiles(transfer([{ file: image }])).files).toEqual([image])
  })

  it('treats text copied with a rendered image as text', () => {
    const image = file('image.png', 'image/png')
    expect(pastedFiles(transfer([{ file: image }], '一段文字')).files).toEqual([])
  })

  it('keeps a document even when the clipboard also has its name as text', () => {
    const doc = file('a.pdf', 'application/pdf')
    expect(pastedFiles(transfer([{ file: doc }], 'a.pdf')).files).toEqual([doc])
  })

  it('reports a pasted folder even when the clipboard has text', () => {
    const got = pastedFiles(transfer([{ file: file('docs'), folder: true }], 'docs'))
    expect(got).toEqual({ files: [], folders: ['docs'] })
  })

  it('leaves plain text alone', () => {
    expect(pastedFiles(transfer([], '一段文字'))).toEqual({ files: [], folders: [] })
  })
})
