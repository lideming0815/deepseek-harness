/** Static or interactive HTML in an opaque iframe, without parent application access. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { createHtmlDocument } from './bootstrap.ts'
import { createBasicHtmlDocument } from './basic-document.ts'
import { packHtml } from './pack.ts'
import { createReadHtmlRelative } from './read-relative.ts'
import { IsolatedHtmlFrame } from './IsolatedHtmlFrame.tsx'
import type { Config } from '../../config.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ReadHtmlRelated } from './read-relative.ts'
import type {} from './locales.ts'
import css from './HtmlBody.module.css'

/** Standard document inputs plus this renderer's dictionary. */
export type HtmlBodyProps = DocumentPreviewProps & PropsLocale<'documentHtml'> & InjectFace<HtmlBodyInjected>

/** Related-file reader and accepted preview mode supplied by the plugin. */
export interface HtmlBodyInjected {
  hooks: { interactivePreview: ObservableSnapshot<boolean> }
  /** Deployment HTML policy; isolated interaction does not enable other Coding Tools. */
  readonly htmlMode: Config['html']['mode']
  /** Ordinary Remote callback bound by this renderer's Slot inject. */
  readonly readRelated: ReadHtmlRelated
}

type FrameInput = Pick<HtmlBodyProps, 'resourceAddress' | 'readRelated' | 'addResource' | 'setResources'> & {
  readonly data: Uint8Array<ArrayBuffer>
  readonly signal: AbortSignal
  readonly frameName: string
  readonly isolated: boolean
}

type FrameState = Pick<FrameInput, 'data' | 'readRelated'> & { readonly url: string | undefined; readonly isolated?: { html: string; token: string } }

/** One mounted file owns its root Blob; replacing content also replaces the browsing context. */
function HtmlFrame({ data, resourceAddress, readRelated, addResource, setResources, signal, frameName, isolated, t }: FrameInput & { t: HtmlBodyProps['t'] }): ReactNode {
  const [frame, setFrame] = useState<FrameState>()
  useEffect(() => {
    const controller = new AbortController()
    const resources = new Set<string>()
    const readRelative = createReadHtmlRelative(readRelated, resourceAddress, signal, (address) => {
      resources.add(address)
      addResource(address)
    })
    let url: string | undefined
    void (async () => {
      try {
        const bundle = await packHtml(data, readRelative, controller.signal, isolated)
        controller.signal.throwIfAborted()
        if (isolated) {
          const token = randomUUID()
          setFrame({ data, readRelated, url: undefined, isolated: { html: createHtmlDocument(bundle, token), token } })
          return
        }
        const html = createHtmlDocument(bundle)
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, readRelated, url })
      } catch {
        if (!controller.signal.aborted) setFrame({ data, readRelated, url: undefined })
      } finally {
        if (!controller.signal.aborted && !signal.aborted) setResources([...resources])
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, readRelated, resourceAddress, addResource, setResources, signal, isolated])

  if (frame?.data !== data || frame.readRelated !== readRelated) {
    return <LoadingIndicator label={t('loading')} />
  }
  if (frame.isolated !== undefined) return <IsolatedHtmlFrame key={frame.isolated.token} {...frame.isolated} frameName={frameName} t={t} />
  if (frame.url === undefined) return <p className={css.status} role="alert">{t('failed')}</p>
  return <iframe key={frame.url} name={frameName} className={css.frame} src={frame.url} sandbox="allow-scripts" title={t('frame')} data-html-preview />
}

/**
 * Render complete HTML with the standard file and tab hooks.
 * @param props - document bytes, hooks, related-file reader and locale.
 * @returns an isolated HTML document, or nothing for text delivery.
 */
export function HtmlBody({
  content, resourceAddress, readRelated, useTabInfo, useInteractivePreview, htmlMode, addResource, setResources, t,
}: HtmlBodyProps): ReactNode {
  const preference = useInteractivePreview(value => value)
  const interactivePreview = htmlMode === 'isolated-interactive' || htmlMode === 'coding-tools' && preference
  const { tab } = useTabInfo()
  useEffect(() => {
    if (!interactivePreview) setResources([])
  }, [interactivePreview, setResources])
  if (content.kind !== 'bytes') return null
  const frameName = `dsh-sidebar-html-${tab.id}`
  if (!interactivePreview) return <BasicHtmlFrame data={content.data} frameName={frameName} t={t} />
  return <HtmlFrame key={`${resourceAddress}:${htmlMode}`} data={content.data} resourceAddress={resourceAddress} isolated={htmlMode === 'isolated-interactive'}
    readRelated={readRelated} signal={tab.signal} frameName={frameName} addResource={addResource} setResources={setResources} t={t} />
}

/** Static preview mounts a separate browsing context so a mode change retires running scripts. */
function BasicHtmlFrame({ data, frameName, t }: Pick<FrameInput, 'data' | 'frameName'> & { t: HtmlBodyProps['t'] }): ReactNode {
  const html = useMemo(() => {
    try {
      return createBasicHtmlDocument(data)
    } catch {
      // Malformed UTF-8 files cannot produce a document.
      return undefined
    }
  }, [data])
  if (html === undefined) return <p className={css.status} role="alert">{t('failed')}</p>
  return <iframe name={frameName} className={css.frame} srcDoc={html} sandbox="" title={t('frame')} data-html-preview />
}
