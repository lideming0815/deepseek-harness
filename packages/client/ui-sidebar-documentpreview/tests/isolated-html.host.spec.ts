/** The trusted document tests native policy before accepting any preview bytes. */
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { isolatedHtmlBootstrap } from '../src/isolated-html.ts'

it.each([[false, false], [true, false], [false, true]])('requires a native report (expired: %s, RTC throws: %s)', (expired, throws) => {
  const parent = { postMessage: vi.fn() }
  const listeners = new Map<string, (event: MessageEvent) => void>()
  const document = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
  let report: ((reports: unknown[]) => void) | undefined
  let expire: (() => void) | undefined
  const disconnect = vi.fn()
  const close = vi.fn()
  const clear = vi.fn()
  const source = isolatedHtmlBootstrap.slice(isolatedHtmlBootstrap.indexOf('<script>') + 8, isolatedHtmlBootstrap.lastIndexOf('</script>'))
  runInNewContext(source, {
    parent, document, setTimeout: (callback: () => void) => { expire = callback; return 1 }, clearTimeout: clear,
    addEventListener: (name: string, callback: (event: MessageEvent) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    ReportingObserver: class {
      constructor(callback: (reports: unknown[]) => void) { report = callback }
      observe() {}
      disconnect = disconnect
      takeRecords() { return [] }
    },
    RTCPeerConnection: class {
      constructor() { if (throws) throw new Error('native policy denied construction') }
      close = close
    },
  })
  const receive = listeners.get('message')!
  const dispatch = (data: unknown, source: unknown = parent) => { receive({ data, source } as MessageEvent) }
  dispatch({ type: 'dsh-html-init', token: 'a-token' }, {})
  expect(close).not.toHaveBeenCalled()
  dispatch({ type: 'dsh-html-init', token: 'a-token' })
  expect(close).toHaveBeenCalledTimes(throws ? 0 : 1)
  dispatch({ type: 'dsh-html-render', token: 'a-token', html: '<p>premature</p>' })
  expect(document.write).not.toHaveBeenCalled()
  report?.([{ type: 'connection-allowlist', body: { connection: 'webrtc', allowlist: [], disposition: 'report' } }])
  report?.([{ type: 'connection-allowlist', body: { connection: 'webrtc', allowlist: ['https://example.invalid'], disposition: 'enforce' } }])
  expect(parent.postMessage).not.toHaveBeenCalled()
  if (expired) expire?.()
  report?.([{ type: 'connection-allowlist', body: { connection: 'webrtc', allowlist: [], disposition: 'enforce' } }])
  if (expired) {
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'dsh-html-unavailable', token: 'a-token' }, '*')
    dispatch({ type: 'dsh-html-render', token: 'a-token', html: '<p>late</p>' })
    expect(document.write).not.toHaveBeenCalled()
    return
  }
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'dsh-html-ready', token: 'a-token' }, '*')
  dispatch({ type: 'dsh-html-render', token: 'other', html: '<p>wrong token</p>' })
  expect(document.write).not.toHaveBeenCalled()
  dispatch({ type: 'dsh-html-render', token: 'a-token', html: '<p>authorized</p>' })
  expect(document.write).toHaveBeenCalledExactlyOnceWith('<p>authorized</p>')
  expect(disconnect).toHaveBeenCalledOnce()
  expect(clear).toHaveBeenCalledOnce()
  expect(listeners.has('message')).toBe(false)
})
