/** Host configuration supplies bounded Office reuse settings to browser pages. */
import { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { expect, it, onTestFinished } from 'vitest'
import { Config } from '../src/config.ts'
import * as host from '../src/index.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { vi } from 'vitest'

it('exposes Client cache and spreadsheet limits on the Host entry', () => {
  expect(host.Config).toBe(Config)
  expect(Config({})).toEqual({ office: {
    maxCachedEntries: 8, maxCachedBytes: 64 * 1024 * 1024, maxPending: 8, maxReaders: 32,
  }, excel: { maxBytes: 16 * 1024 * 1024, maxCells: 250_000, timeoutMs: 15_000 }, html: { mode: 'coding-tools' } })
  expect(Config({ html: { mode: 'isolated-interactive' } }).html.mode).toBe('isolated-interactive')
  expect(Config({ html: { mode: 'static' } }).html.mode).toBe('static')
  expect(() => Config({ html: { mode: 'unchecked' } } as never)).toThrow()
  for (const key of ['maxCachedEntries', 'maxCachedBytes']) expect(() => Config({ office: { [key]: 0 } })).toThrow()
  for (const key of ['maxBytes', 'maxCells', 'timeoutMs']) expect(() => Config({ excel: { [key]: 0 } })).toThrow()
  expect(() => Config({ excel: { timeoutMs: 2_147_483_648 } })).toThrow()
})

it('embeds YAML cache settings in browser pages and withdraws them on disposal', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const config = Config({ office: { maxCachedEntries: 2 } })
  const fiber = ctx.plugin(host, config)
  await fiber.await()
  const rows: IndexInjection[] = []
  ctx.emit('webserver/index-inject', rows)
  expect(rows).toEqual([{ kind: 'global', name: '__DSH_DOCUMENT_PREVIEW_CONFIG__', value: config }])
  await fiber.dispose()
  const after: IndexInjection[] = []
  ctx.emit('webserver/index-inject', after)
  expect(after).toEqual([])
})

it('registers only the configured trusted isolation bootstrap and retires its route', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const remove = vi.fn()
  const register = vi.fn<(route: WebRoute) => () => void>().mockReturnValue(remove)
  ctx.provide('webServer', { register } as never)
  const defaultFiber = ctx.plugin(host, Config({}))
  await defaultFiber.await()
  expect(register).not.toHaveBeenCalled()
  await defaultFiber.dispose()
  const fiber = ctx.plugin(host, Config({ html: { mode: 'isolated-interactive' } }))
  await fiber.await()
  expect(register).toHaveBeenCalledOnce()
  expect(register.mock.calls[0]?.[0]).toMatchObject({ kind: 'exact', path: '/assets/document-preview/isolated-html' })
  await fiber.dispose()
  expect(remove).toHaveBeenCalledOnce()
})
