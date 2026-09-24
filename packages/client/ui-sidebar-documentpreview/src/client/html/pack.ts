/** Finite HTML-declared resources; isolated mode rejects dependencies it cannot package. */
import type { HtmlAsset, HtmlBundle } from './bootstrap.ts'
import type { DocumentFileBytes } from '../rpc.ts'
import { decodeText } from './bytes.ts'
import { htmlRelativePath } from './read-relative.ts'

/**
 * A read bound to the original document's session and directory, using ordinary file operations.
 * @param reference - HTML-decoded relative URL, including any query or fragment; the reader resolves its file path.
 * @param signal - cancellation of this packing operation.
 * @returns complete file bytes; permission and read failures reject.
 */
export type ReadHtmlRelative = (reference: string, signal: AbortSignal) => Promise<DocumentFileBytes>

const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
}

/** Reject resource-bearing CSS until recursive CSS packaging is supported. */
function standaloneCss(text: string): void {
  // ponytail: reject CSS references and escapes; use a CSS parser when recursive dependencies are required.
  if (/\\|(?:url|image(?:-set)?)\s*\(|@import/iu.test(text)) throw new Error('HTML CSS dependencies are unsupported')
}

/** Inspect inert nodes before any source document can initiate browser resource requests. */
function isolatedElements(root: DocumentFragment): void {
  for (const element of root.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase()
    if (/^(?:base|iframe|frame|frameset|object|embed|form|audio|video|source|track|template)$/u.test(tag)
      || /^(?:foreignobject|animate\w*|set|portal|fencedframe)$/u.test(tag)) {
      throw new Error('HTML contains an unsupported element')
    }
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (tag === 'script' && !['', 'text/javascript', 'application/javascript'].includes(type)) {
      throw new Error('HTML requires classic scripts')
    }
    if (tag === 'link' && (element.getAttribute('rel')?.trim().toLowerCase() !== 'stylesheet' || !element.hasAttribute('href'))) {
      throw new Error('HTML contains an unsupported link')
    }
    if (tag === 'style') standaloneCss(element.textContent)
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      if (['style', 'fill', 'stroke', 'filter', 'mask', 'clip-path'].includes(name)) standaloneCss(attribute.value)
      if (/^(?:srcset|imagesrcset|srcdoc|action|formaction|form|ping|poster|background|data|codebase|archive)$/u.test(name)
        || ['manifest', 'http-equiv'].includes(name)
        || (name.startsWith('src') && !(name === 'src' && ['img', 'script'].includes(tag)))
        || (['href', 'xlink:href'].includes(name) && !(tag === 'link' && name === 'href')
          && !attribute.value.startsWith('#'))) {
        throw new Error('HTML contains an unsupported resource attribute')
      }
    }
  }
}

/** Image documents remain passive and cannot introduce a second resource graph. */
function standaloneSvg(data: Uint8Array<ArrayBuffer>): void {
  const text = decodeText(data)
  if (/<(?:script|link|base|iframe|frame|object|embed|form|input|button|audio|video|template)\b/iu.test(text)
    || /<(?:animate\w*|set|foreignObject)\b|<!ENTITY\b|\b(?:src\w*|href|action|poster|http-equiv|on\w+)\s*=/iu.test(text)
    || /(?:url|image(?:-set)?)\s*\(|@import|\\/iu.test(text)) {
    throw new Error('SVG image dependencies are unsupported')
  }
}

/** Whether this reference can be read relative to the original document, never the parent application URL. */
function relative(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/iu.test(reference) && !reference.includes('\0')
}

/**
 * Collect static dependencies without executing or mounting document elements in the parent page.
 * A base element leaves URL resolution to the browser. Only direct .js classic scripts and .css
 * links are packed; local CSS url/import, modules and dynamically constructed URLs are unsupported.
 * @param data - complete UTF-8 HTML bytes.
 * @param readRelative - original-document-scoped read, never exposed to the iframe.
 * @param signal - stops reads and prevents publication after cancellation.
 * @param isolated - require only local images, classic scripts, and standalone stylesheets.
 * @returns complete HTML and its finite static asset set; decoding, limits and read failures reject.
 */
export async function packHtml(
  data: Uint8Array<ArrayBuffer>,
  readRelative: ReadHtmlRelative,
  signal: AbortSignal,
  isolated = false,
): Promise<HtmlBundle> {
  signal.throwIfAborted()
  let total = data.byteLength
  if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
  const template = document.createElement('template')
  const html = decodeText(data)
  // A fragment parser drops html/head/body attributes; retain them only in this inert validation copy.
  template.innerHTML = isolated ? html.replace(/<(\/?)(html|head|body)(?=[\s/>])/giu, '<$1dsh-document-$2') : html
  const assets: HtmlAsset[] = []
  if (isolated) isolatedElements(template.content)
  if (template.content.querySelector('base[href]') !== null) return { data, assets }

  const seen = new Set<string>()
  for (const element of template.content.querySelectorAll(isolated ? 'script[src],link[href],img[src]' : 'script[src],link[href]')) {
    const script = element.localName === 'script'
    const image = element.localName === 'img'
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (!script && !image && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/u).includes('stylesheet')) continue
    // The selector requires the corresponding URL attribute.
    const reference = element.getAttribute(script || image ? 'src' : 'href') as string
    if (image && reference.startsWith('data:')) {
      const match = /^data:(image\/(?:png|jpeg|gif|webp|bmp|svg\+xml));base64,([a-z\d+/]*={0,2})$/iu.exec(reference)
      if (!match || !match[2] || btoa(atob(match[2])) !== match[2]) throw new Error('HTML image data is unsupported')
      if (match[1]?.toLowerCase() === 'image/svg+xml') standaloneSvg(Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)))
      continue
    }
    const suffix = reference.search(/[?#]/u)
    const path = isolated ? htmlRelativePath(reference) : suffix === -1 ? reference : reference.slice(0, suffix)
    const mediaType = IMAGE_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]
    if (!relative(reference) || !(image ? mediaType !== undefined : (script ? /\.js$/iu : /\.css$/iu).test(path))) {
      if (isolated) throw new Error('HTML resource must be a supported relative file')
      continue
    }
    const kind = image ? 'image' : script ? 'script' : 'stylesheet'
    const key = `${kind}:${reference}`
    if (seen.has(key)) continue
    if (assets.length >= MAX_ASSETS) throw new Error('HTML package exceeds its asset count limit')
    signal.throwIfAborted()
    const asset = await readRelative(reference, signal)
    signal.throwIfAborted()
    const size = asset.data.byteLength
    if (size > MAX_ASSET_BYTES) throw new Error('HTML asset exceeds its byte limit')
    total += size
    if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
    if (!image) {
      const text = decodeText(asset.data)
      if (isolated && !script) standaloneCss(text)
    } else if (mediaType === 'image/svg+xml') standaloneSvg(asset.data)
    assets.push({ kind, reference, data: asset.data, ...image ? { mediaType } : {} })
    seen.add(key)
  }
  return { data, assets }
}
