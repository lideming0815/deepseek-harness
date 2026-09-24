/** Real native HTML isolation with the owning Host route and loopback HTTP/WebRTC sinks. */
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vitest'
import * as preview from '../../../packages/client/ui-sidebar-documentpreview/src/index.ts'
import { isolatedHtmlPath } from '../../../packages/client/ui-sidebar-documentpreview/src/isolated-html.ts'
import { createHtmlDocument } from '../../../packages/client/ui-sidebar-documentpreview/src/client/html/bootstrap.ts'
import { assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)
const token = 'native-isolation-fixture'
const documentHtml = '<!doctype html><link rel="stylesheet" href="a.css"><h1>本地报告</h1><p id="result"></p>'
  + '<img alt="local chart" src="a.svg"><button onclick="this.textContent=\'clicked\'">Details</button><script src="a.js"></script>'
const assets = [
  { kind: 'stylesheet', reference: 'a.css', data: encode('h1{color:rgb(17,34,51)}') },
  { kind: 'script', reference: 'a.js', data: encode('document.querySelector("#result").textContent="经典脚本"') },
  { kind: 'image', reference: 'a.svg', mediaType: 'image/svg+xml',
    data: encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text y="20">图表</text></svg>') },
] as const
const html = createHtmlDocument({ data: encode(documentHtml), assets }, token)
const snapshotDir = fileURLToPath(new URL('../../../snapshots/web/isolated-html-policy', import.meta.url))
const parentHtml = `<!doctype html><meta charset="utf-8"><output id="events">pending</output><script>
addEventListener('message',event=>{
  if(event.source!==document.querySelector('iframe').contentWindow||event.data.token!=='${token}')return;
  document.querySelector('#events').textContent+=' '+event.data.type;
  if(event.data.type==='dsh-html-loaded')document.querySelector('iframe').hidden=false;
  if(event.data.type==='dsh-html-ready')event.source.postMessage({type:'dsh-html-render',token:'${token}',html:${JSON.stringify(html).replaceAll('<', '\\u003c')}},'*');
});
</script><iframe hidden sandbox="allow-scripts" title="Isolated preview" src="${isolatedHtmlPath}"
onload="if(!this.dataset.initialized){this.dataset.initialized='true';this.contentWindow.postMessage({type:'dsh-html-init',token:'${token}'},'*')}"></iframe>`

const ctx = new Context()
const udp = createSocket('udp4')
const httpHits: string[] = []
const udpHits: number[] = []
let base: string
let udpPort: number
let udpListening = false

beforeAll(async () => {
  udp.on('message', (data) => { udpHits.push(data.byteLength) })
  udp.bind(0, '127.0.0.1')
  await once(udp, 'listening')
  udpListening = true
  udpPort = udp.address().port
  await ctx.plugin(WebServer, WebServer.Config({ host: '127.0.0.1', port: 0 }))
  await ctx.plugin(preview, preview.Config({ html: { mode: 'isolated-interactive' } }))
  base = `http://127.0.0.1:${ctx.webServer.port}`
  ctx.webServer.register({ kind: 'exact', path: '/', handler: (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(parentHtml)
  } })
  ctx.webServer.register({ kind: 'prefix', path: '/sink', handler: (req, res) => {
    httpHits.push(req.url ?? '')
    res.end('synthetic loopback sink')
  } })
  await fetch(`${base}/sink/control`)
  const control = once(udp, 'message')
  udp.send(Buffer.from('synthetic control'), udpPort, '127.0.0.1')
  await control
  expect(udpHits).toHaveLength(1)
  expect(httpHits).toEqual(['/sink/control'])
  udpHits.length = 0
  httpHits.length = 0
})

afterAll(async () => {
  try {
    if (udpListening) await new Promise<void>(resolve => udp.close(resolve))
  } finally {
    await ctx.fiber.dispose()
  }
})

/** The same test can use a locally installed browser without committing machine-specific paths. */
async function launchBrowser(enabled: boolean): Promise<Browser> {
  const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
  return await chromium.launch({
    ...executablePath === undefined ? {} : { executablePath },
    // Chromium versions still in the origin trial exercise their real policy implementation here.
    args: [enabled
      ? '--enable-features=ConnectionAllowlists,OverrideConnectionAllowlistOriginTrial'
      : '--disable-features=ConnectionAllowlists'],
  })
}

/** Each policy probe owns and closes its browser even after assertion failures. */
async function browserPage(enabled: boolean): Promise<{ browser: Browser; page: Page }> {
  const browser = await launchBrowser(enabled)
  onTestFinished(async () => { await browser.close() })
  return { browser, page: await browser.newPage() }
}

it('serves only a trusted static bootstrap with native enforced policy and no reporting destination', async () => {
  const response = await fetch(`${base}${isolatedHtmlPath}`)
  expect(response.status).toBe(200)
  expect(response.headers.get('connection-allowlist')).toBe('(); report-to=preview')
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  expect(response.headers.get('reporting-endpoints')).toBeNull()
  expect(await response.text()).not.toContain('本地报告')
  expect((await fetch(`${base}${isolatedHtmlPath}?file=private.html`)).status).toBe(400)
})

it('renders packaged CSS, classic JS and images, and blocks runtime HTTP, WebRTC, parent access and self-navigation', async () => {
  const { page } = await browserPage(true)
  await page.goto(base)
  await expect.poll(() => page.locator('#events').textContent(), { timeout: 8000 }).toContain('dsh-html-loaded')
  const frame = page.frameLocator('iframe')
  expect(await frame.getByRole('heading').textContent()).toBe('本地报告')
  expect(await frame.locator('#result').textContent()).toBe('经典脚本')
  expect(await frame.getByRole('heading').evaluate(node => getComputedStyle(node).color)).toBe('rgb(17, 34, 51)')
  expect(await frame.getByRole('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(100)
  await frame.getByRole('button').press('Enter')
  expect(await frame.getByRole('button').textContent()).toBe('clicked')
  expect(await page.locator('#events').textContent()).not.toContain('dsh-html-failed')
  const denied = await frame.getByRole('button').evaluate((_node, { base, udpPort }) => {
    let parentDenied = false, cookieDenied = false
    try { void parent.document.body } catch { parentDenied = true }
    try { void document.cookie } catch { cookieDenied = true }
    void fetch(`${base}/sink/fetch`, { mode: 'no-cors' }).catch(() => {})
    new Image().src = `${base}/sink/image`
    try {
      const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${udpPort}` }] })
      peer.createDataChannel('synthetic')
      void peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => {})
    } catch {
      // Native engines may reject construction or block the subsequent connection.
    }
    const child = document.createElement('iframe')
    child.srcdoc = `<script>fetch('${base}/sink/descendant').catch(()=>{})<` + '/script>'
    document.body.append(child)
    return { parentDenied, cookieDenied }
  }, { base, udpPort })
  expect(denied).toEqual({ parentDenied: true, cookieDenied: true })
  await expect.poll(() => page.locator('#events').textContent()).toContain('dsh-html-failed')
  await frame.getByRole('button').evaluate((_node, url) => { setTimeout(() => { location.href = url }, 0) }, `${base}/sink/navigation`)
  // Give the loopback STUN retry and navigation paths an observation window.
  await page.waitForTimeout(600)
  expect(httpHits).toEqual([])
  expect(udpHits).toEqual([])
})

it.each(['stripped-header', 'unsupported-policy'] as const)('withholds all document bytes for %s', async (mode) => {
  const { page } = await browserPage(mode !== 'unsupported-policy')
  if (mode === 'stripped-header') await page.route(`**${isolatedHtmlPath}`, async (route) => {
    const response = await route.fetch()
    const headers = response.headers()
    delete headers['connection-allowlist']
    await route.fulfill({ response, headers })
  })
  await page.goto(base)
  await expect.poll(() => page.locator('#events').textContent(), { timeout: 8000 }).toContain('dsh-html-unavailable')
  expect(await page.locator('#events').textContent()).not.toContain('dsh-html-ready')
  expect(await page.frameLocator('iframe').getByRole('heading').count()).toBe(0)
  expect(httpHits).toEqual([])
  expect(udpHits).toEqual([])
})

it('shows the shipped Files preview and fail-closed feedback with Coding tools disabled', async () => {
  const scaffold = await launchWebScaffold({
    developerTools: false,
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v4.jsonl', import.meta.url)),
    compareReplaySession: 'read-only',
    paceMs: 5,
    extraOverlayPath: join(snapshotDir, 'preview.patch.yml'),
  })
  let browser: Browser | undefined
  try {
    browser = await launchBrowser(true)
    const page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill('Reply with the single word LIGHTHOUSE and stop.')
    await input.press('Enter')
    const sessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')
    await Promise.all([
      writeFile(join(cwd, 'report.html'), documentHtml),
      writeFile(join(cwd, 'unavailable.html'), documentHtml),
      ...assets.map(asset => writeFile(join(cwd, asset.reference), asset.data)),
    ])
    const column = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'report.html', exact: true }).click()
    const preview = column.locator('[data-textpreview-url]')
    const frame = page.frameLocator('[data-html-preview]')
    await preview.locator('[data-html-preview]').waitFor({ state: 'visible' })
    expect(await frame.getByRole('heading').textContent()).toBe('本地报告')
    expect(await frame.locator('#result').textContent()).toBe('经典脚本')
    const color = await frame.getByRole('heading').evaluate(node => getComputedStyle(node).color)
    const width = await frame.getByRole('img').evaluate(node => (node as HTMLImageElement).naturalWidth)
    expect(color).toBe('rgb(17, 34, 51)')
    expect(width).toBe(100)
    await frame.getByRole('button').press('Enter')
    expect(await frame.getByRole('button').textContent()).toBe('clicked')
    const success = await frame.locator('body').ariaSnapshot()
    const sandbox = await preview.locator('[data-html-preview]').getAttribute('sandbox')
    expect(sandbox).toBe('allow-scripts')
    expect(await preview.getByRole('alert').count()).toBe(0)

    await page.route(`**${isolatedHtmlPath}`, async (route) => {
      const response = await route.fetch()
      const headers = response.headers()
      delete headers['connection-allowlist']
      await route.fulfill({ response, headers })
    })
    await column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) }).click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'unavailable.html', exact: true }).click()
    const alert = preview.getByRole('alert')
    await expect.poll(() => alert.textContent(), { timeout: 10_000 })
      .toBe('This browser or server does not support isolated interactive previews.')
    expect(await preview.locator('[data-html-preview]').count()).toBe(0)
    expect(await preview.getByRole('status').count()).toBe(0)
    await compareOrRefreshGolden(join(snapshotDir, 'preview.expected.md'), [
      '# Isolated HTML preview', '', '## Rendered document', '',
      '- Coding tools: disabled', `- Sandbox: ${sandbox}`, `- Heading color: ${color}`, `- Image width: ${width}`,
      '', '```yaml', success, '```', '', '## Missing native policy', '',
      '```yaml', await alert.ariaSnapshot(), '```',
    ].join('\n'), webSnapshotMode())
    await assertFixtureInventory(snapshotDir, ['preview.expected.md', 'preview.patch.yml'])
  } finally {
    try {
      await browser?.close()
    } finally {
      await scaffold.close()
    }
  }
})
