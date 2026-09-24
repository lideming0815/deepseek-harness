/** A fixed bootstrap runs inside the opaque iframe; no Host callbacks enter its document. */
import { decodeText, encodeText } from './bytes.ts'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'

/** One statically declared local script or stylesheet, already read under the source file's authority. */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet' | 'image'
  /** Original HTML attribute, not a Host absolute path. */
  readonly reference: string
  readonly data: Uint8Array<ArrayBuffer>
  /** Image MIME type, absent for the two fixed text types. */
  readonly mediaType?: string
}

/** Complete bytes for one document; dependencies are finite and never requested by iframe messages. */
export interface HtmlBundle {
  readonly data: Uint8Array<ArrayBuffer>
  readonly assets: readonly HtmlAsset[]
}

/**
 * Build the outer iframe document. Its resource URLs are created inside the sandbox,
 * because that opaque origin cannot load resource URLs created by the parent.
 * @param bundle - complete HTML bytes and optional static dependencies.
 * @param runtimeToken - optional isolated-frame identity for lifecycle and failure reports.
 * @returns bootstrap HTML; invalid UTF-8 throws before navigation.
 */
export function createHtmlDocument(bundle: HtmlBundle, runtimeToken?: string): string {
  const payload = encodeText(JSON.stringify({
    html: decodeText(bundle.data),
    runtimeToken,
    assets: bundle.assets.map(asset => ({ kind: asset.kind, reference: asset.reference, mediaType: asset.mediaType,
      text: asset.kind === 'image' ? bytesToBase64(asset.data) : decodeText(asset.data) })),
  }))
  return `<!doctype html><meta charset="utf-8"><script>(()=>{
const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));
const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));
const bundle=JSON.parse(text("${payload}"));
let html=bundle.html;
if(bundle.assets.length||bundle.runtimeToken){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  if(bundle.runtimeToken){
    const monitor=parsed.createElement('script');
    monitor.textContent='(()=>{const token='+JSON.stringify(bundle.runtimeToken)+';const send=type=>parent.postMessage({type,token},"*");addEventListener("error",()=>send("dsh-html-failed"),true);addEventListener("unhandledrejection",()=>send("dsh-html-failed"));addEventListener("securitypolicyviolation",()=>send("dsh-html-failed"));addEventListener("pagehide",()=>send("dsh-html-failed"));addEventListener("load",()=>send("dsh-html-loaded"),{once:true});new ReportingObserver(reports=>{if(reports.some(report=>report.type==="connection-allowlist"&&report.body.disposition==="enforce"))send("dsh-html-failed")},{types:["connection-allowlist"]}).observe()})()';
    parsed.head.prepend(monitor);
  }
  for(const asset of bundle.assets){
    const script=asset.kind==='script';
    const image=asset.kind==='image';
    const url=URL.createObjectURL(new Blob([image?bytes(asset.text):asset.text],{type:image?asset.mediaType:script?'application/javascript':'text/css'}));
    const attribute=script||image?'src':'href';
    for(const element of parsed.querySelectorAll(image?'img[src]':script?'script[src]':'link[rel~="stylesheet" i][href]')){
      if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url);
    }
  }
  html='<!doctype html>'+parsed.documentElement.outerHTML;
}
document.open();document.write(html);document.close();
})()</script>`
}
