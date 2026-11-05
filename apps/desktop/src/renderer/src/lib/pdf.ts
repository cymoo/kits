import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { kits } from './kits'

// PDF 预览：渲染进程用 pdfjs-dist 画到 canvas。CMap、标准字体、解码器随包发在主进程那边，
// 经 IPC 取，不用把几百个小文件打进页面。

type AssetKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

class Assets {
  fetch({ kind, filename }: { kind: AssetKind; filename: string }): Promise<Uint8Array> {
    return kits.files.pdfAsset({ kind, filename })
  }
}

let worker: Worker | undefined

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await import('pdfjs-dist')
  // 页面是 file:// 时 pdfjs 自己建的跨源包装过不了 CSP，这里直接给它一个
  worker ??= new Worker(workerUrl, { type: 'module' })
  pdfjs.GlobalWorkerOptions.workerPort = worker
  return pdfjs.getDocument({
    // pdfjs 会把传进去的数组转给 worker，给它一份拷贝
    data: data.slice(),
    BinaryDataFactory: Assets,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    // 只是占位：有值才会来要，实际走上面的 Assets
    cMapUrl: 'pdf/cmaps/',
    standardFontDataUrl: 'pdf/fonts/',
    wasmUrl: 'pdf/wasm/',
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise
}
