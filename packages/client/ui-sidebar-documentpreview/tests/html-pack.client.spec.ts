// @vitest-environment jsdom
/** Static dependency discovery has an injected file reader and never exposes it to the iframe. */
import { describe, expect, it, vi } from 'vitest'
import { packHtml } from '../src/client/html/pack.ts'
import type { ReadHtmlRelative } from '../src/client/html/pack.ts'
import type { DocumentFileBytes } from '../src/client/rpc.ts'

const source = '<link rel="stylesheet" href="./main.css"><script src="./main.js"></script>'

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)
const file = (data: Uint8Array<ArrayBuffer>): DocumentFileBytes => ({
  absolutePath: '/workspace/asset', version: 'v1', offset: 0, data, bytes: data.byteLength, eof: true,
})

describe('packHtml', () => {
  it('packs binary local images with styles and classic scripts in isolated mode', async () => {
    const image = new Uint8Array([137, 80, 78, 71])
    const read = vi.fn<ReadHtmlRelative>().mockImplementation(async reference => file(reference.endsWith('.png') ? image : utf8('/* standalone */')))
    const bundle = await packHtml(utf8(source + '<img src="./图.png"><img src="./图.png">'), read, new AbortController().signal, true)
    expect(bundle.assets.map(asset => asset.kind)).toEqual(['stylesheet', 'script', 'image'])
    expect(bundle.assets[2]?.data).toEqual(image)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it.each([
    '<img src="https://example.invalid/image.png">', '<img src="/image.png">', '<img srcset="a.png 1x">',
    '<script type="module">import "./app.js"</script>', '<script src="./unsupported.txt"></script>',
    '<link rel="icon" href="./a.png">', '<base href="./">', '<iframe src="./child.html"></iframe>',
    '<form action="./post"><input></form>', '<meta http-equiv="refresh" content="0;url=https://example.invalid">',
    '<svg><image href="./a.png"/></svg>', '<a href="./report.html">report</a>', '<video poster="./a.png"></video>',
    '<style>div{background:u\\72l(a.png)}</style>', '<div style="background:image-set(\'a.png\' 1x)"></div>',
    '<style>@import "a.css";</style>', '<style>div{background:url(a.png)}</style>',
    '<html manifest="./cache.appcache"><body>root</body></html>', '<body background="./a.png">root</body>',
    '<html style="background:url(./a.png)"><body>root</body></html>',
  ])('rejects unsupported isolated dependencies before opening a frame: %s', async (html) => {
    const read = vi.fn<ReadHtmlRelative>()
    await expect(packHtml(utf8(html), read, new AbortController().signal, true)).rejects.toThrow()
  })

  it('rejects dependent stylesheets and preserves missing-file failures in isolated mode', async () => {
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(utf8('body{background:url(hidden.png)}')))
    await expect(packHtml(utf8(source), read, new AbortController().signal, true)).rejects.toThrow('CSS')
    read.mockRejectedValue(new Error('missing fixed-version file'))
    await expect(packHtml(utf8('<img src="./missing.png">'), read, new AbortController().signal, true)).rejects.toThrow('missing fixed-version file')
  })

  it('checks once-decoded local filenames and accepts canonical passive image data', async () => {
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(new Uint8Array([137, 80, 78, 71])))
    const bundle = await packHtml(utf8('<img src=" ./a%2Epng?v=1#part "><img src="data:image/png;base64,iVBORw==">'), read, new AbortController().signal, true)
    expect(bundle.assets).toHaveLength(1)
    expect(read.mock.calls[0]?.[0]).toBe(' ./a%2Epng?v=1#part ')
    for (const html of ['<img src="data:image/png;base64,">', '<img src="data:image/png;base64,eA=">', '<img src="./a%0Apng.png">', '<button form="outer">send</button>', '<svg><rect fill="url(https://example.invalid/a.svg)"/></svg>']) {
      await expect(packHtml(utf8(html), read, new AbortController().signal, true)).rejects.toThrow()
    }
  })

  it('rejects resource-bearing SVG in local and inline images', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>'
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(utf8(svg)))
    await expect(packHtml(utf8('<img src="a.svg">'), read, new AbortController().signal, true)).rejects.toThrow('SVG')
    await expect(packHtml(utf8(`<img src="data:image/svg+xml;base64,${btoa(svg)}">`), read, new AbortController().signal, true)).rejects.toThrow('SVG')
  })

  it('collects direct classic JS and CSS in document order and deduplicates repeated references', async () => {
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(utf8('/* 你好 */')))
    const signal = new AbortController().signal
    const bundle = await packHtml(utf8(source + '<script defer src="./main.js"></script>'), read, signal)
    expect(read.mock.calls).toEqual([['./main.css', signal], ['./main.js', signal]])
    expect(bundle.assets.map(asset => [asset.kind, asset.reference])).toEqual([['stylesheet', './main.css'], ['script', './main.js']])
    expect(document.querySelector('script,link')).toBeNull()
  })

  it('leaves HTTPS, module, file, root-relative, data and runtime dependencies to browser rules', async () => {
    const read = vi.fn<ReadHtmlRelative>()
    const html = '<script src="https://example.invalid/a.js"></script><script src="//example.invalid/a.js"></script><script type="module" src="./module.js"></script><script type="application/ld+json" src="./data.js"></script><script src="file:///a.js"></script><script src="/a.js"></script><script src="data:text/javascript,1"></script><script>fetch("./data.json")</script><link rel="icon" href="./icon.css"><!-- <script src="./comment.js"></script> -->'
    expect((await packHtml(utf8(html), read, new AbortController().signal)).assets).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('does not turn base-relative browser resources into local file reads', async () => {
    const read = vi.fn<ReadHtmlRelative>()
    for (const base of ['https://example.invalid/assets/', './assets/', 'file:///assets/']) {
      const bundle = await packHtml(utf8(`<base href="${base}">${source}`), read, new AbortController().signal)
      expect(bundle.assets).toEqual([])
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('does not read a link without a stylesheet relationship', async () => {
    const read = vi.fn<ReadHtmlRelative>()
    const bundle = await packHtml(utf8('<link href="./main.css">'), read, new AbortController().signal)
    expect(bundle.assets).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('passes decoded HTML attributes to the scoped reader without recursing into CSS imports', async () => {
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(utf8('@import "./child.css";a{background:url(./image.png)}')))
    const bundle = await packHtml(utf8('<link rel="STYLESHEET" href="main.css?v=1&amp;x=2">'), read, new AbortController().signal)
    expect(read.mock.calls[0]?.[0]).toBe('main.css?v=1&x=2')
    expect(read).toHaveBeenCalledOnce()
    expect(bundle.assets).toHaveLength(1)
  })

  it('accepts the fixed per-asset limit and rejects oversized roots and assets', async () => {
    const mebibyte = 1024 * 1024
    const html = utf8('<script src="a.js"></script>')
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(new Uint8Array(4 * mebibyte)))
    const signal = new AbortController().signal
    await expect(packHtml(html, read, signal)).resolves.toMatchObject({ data: html })
    await expect(packHtml(new Uint8Array(32 * mebibyte + 1), read, signal)).rejects.toThrow('total byte limit')
    read.mockResolvedValue(file(new Uint8Array(4 * mebibyte + 1)))
    await expect(packHtml(html, read, signal)).rejects.toThrow('asset exceeds')
  })

  it('rejects fixed aggregate and asset-count limits', async () => {
    const mebibyte = 1024 * 1024
    const aggregate = Array.from({ length: 8 }, (_, index) => `<script src="${index}.js"></script>`).join('')
    const read = vi.fn<ReadHtmlRelative>().mockResolvedValue(file(new Uint8Array(4 * mebibyte)))
    await expect(packHtml(utf8(aggregate), read, new AbortController().signal)).rejects.toThrow('total byte limit')

    const count = Array.from({ length: 65 }, (_, index) => `<script src="${index}.js"></script>`).join('')
    read.mockResolvedValue(file(new Uint8Array()))
    await expect(packHtml(utf8(count), read, new AbortController().signal)).rejects.toThrow('asset count limit')
    expect(read).toHaveBeenCalledTimes(8 + 64)
  })

  it('propagates read errors and rejects malformed resource text instead of returning a partial package', async () => {
    const read = vi.fn<ReadHtmlRelative>().mockRejectedValue(new Error('outside workspace'))
    await expect(packHtml(utf8(source), read, new AbortController().signal)).rejects.toThrow('outside workspace')
    read.mockResolvedValue(file(new Uint8Array([255])))
    await expect(packHtml(utf8(source), read, new AbortController().signal)).rejects.toThrow()
  })

  it('does not read after abort and discards a read that settles after cancellation', async () => {
    const pending = Promise.withResolvers<DocumentFileBytes>()
    const read = vi.fn<ReadHtmlRelative>().mockReturnValue(pending.promise)
    const controller = new AbortController()
    const packing = packHtml(utf8(source), read, controller.signal)
    expect(read).toHaveBeenCalledOnce()
    const rejected = expect(packing).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    pending.resolve(file(utf8('body{}')))
    await rejected
    await expect(packHtml(utf8(source), read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledOnce()
  })
})
