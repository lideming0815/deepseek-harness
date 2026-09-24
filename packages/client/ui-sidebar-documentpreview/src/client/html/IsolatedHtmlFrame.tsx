/** Send a prepared document only to the opaque frame that proves native network isolation. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HtmlBodyProps } from './HtmlBody.tsx'
import { isolatedHtmlPath } from '../../isolated-html.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import css from './HtmlBody.module.css'

/** Authorized finite document and one mount's message identity. */
interface Props {
  readonly html: string
  readonly token: string
  readonly frameName: string
  readonly t: HtmlBodyProps['t']
}

/**
 * Mount the trusted Host bootstrap, then keep failure reporting bound to its browsing context.
 * @param props - completed HTML, per-mount challenge, accessible frame name and locale.
 * @returns a native isolated iframe or an explicit unsupported/failure message.
 */
export function IsolatedHtmlFrame({ html, token, frameName, t }: Props): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null)
  const loads = useRef(0)
  const [failure, setFailure] = useState<'failed' | 'unavailable'>()
  const [loading, setLoading] = useState(true)
  const base = new URL(document.baseURI)
  const supportedBase = base.protocol === 'https:' || base.protocol === 'http:'
  const src = supportedBase ? new URL(isolatedHtmlPath.slice(1), base).href : undefined
  useEffect(() => {
    let delivered = false
    let timer = setTimeout(() => { setFailure('unavailable') }, 8000)
    const receive = (event: MessageEvent): void => {
      const source = frame.current?.contentWindow
      const data: unknown = event.data
      if (!source || event.source !== source || typeof data !== 'object' || data === null
        || !('token' in data) || data.token !== token || !('type' in data)) return
      switch (data.type) {
        case 'dsh-html-ready':
          if (delivered) return
          delivered = true
          clearTimeout(timer)
          timer = setTimeout(() => { setFailure('failed') }, 10_000)
          source.postMessage({ type: 'dsh-html-render', token, html }, '*')
          break
        case 'dsh-html-loaded':
          if (!delivered) return
          clearTimeout(timer)
          setLoading(false)
          break
        case 'dsh-html-unavailable':
        case 'dsh-html-failed':
          clearTimeout(timer)
          setFailure(data.type === 'dsh-html-unavailable' ? 'unavailable' : 'failed')
          break
      }
    }
    window.addEventListener('message', receive)
    return () => { clearTimeout(timer); window.removeEventListener('message', receive) }
  }, [html, token])
  if (failure !== undefined || !supportedBase) return <p className={css.status} role="alert">{t(failure ?? 'unavailable')}</p>
  return <>
    {loading && <LoadingIndicator label={t('loading')} />}
    <iframe ref={frame} name={frameName} className={css.frame} src={src} hidden={loading}
      sandbox="allow-scripts" referrerPolicy="no-referrer" title={t('frame')} data-html-preview
      onError={() => { setFailure('unavailable') }} onLoad={() => {
        loads.current += 1
        if (loads.current === 1) frame.current?.contentWindow?.postMessage({ type: 'dsh-html-init', token }, '*')
        else if (loads.current > 2) setFailure('failed')
      }} />
  </>
}
