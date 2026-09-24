/** Host configuration for browser document previews. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'
import { isolatedHtmlBootstrap, isolatedHtmlCsp, isolatedHtmlPath } from './isolated-html.ts'

export { Config } from './config.ts'

/**
 * Embed validated preview settings in browser pages.
 * @param ctx - Host context serving browser pages.
 * @param config - Preview policy and cache limits adopted when the page loads.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_DOCUMENT_PREVIEW_CONFIG__', value: config })
  })
  if (config.html.mode === 'isolated-interactive') ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: isolatedHtmlPath,
      handler: (req, res) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url?.includes('?')) {
          res.writeHead(400)
          res.end()
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': isolatedHtmlCsp,
          'Connection-Allowlist': '(); report-to=preview',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(req.method === 'HEAD' ? undefined : isolatedHtmlBootstrap)
      },
    }), 'documentpreview: isolated HTML bootstrap')
  })
}
