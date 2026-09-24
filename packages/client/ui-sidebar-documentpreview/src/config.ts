/** Execution policy and cache limits shared by Host configuration and browser document previews. */
import z from '@deepseek-ai/schemastery'

/** HTML execution policy and bounded document processing within one Client connection. */
export interface Config {
  /** HTML execution policy, independent from other Coding Tools capabilities. */
  html: {
    /** Coding Tools preserves the user preference; isolated mode requires a finite local resource set. */
    mode: 'coding-tools' | 'static' | 'isolated-interactive'
  }
  /** Retained PDF limits; pending conversions share cancellation by reader lifetime. */
  office: {
    /** Maximum retained completed PDFs. */
    maxCachedEntries: number
    /** Maximum retained PDF bytes, counted by each binary buffer's byteLength. */
    maxCachedBytes: number
    /** Maximum unsettled Host conversion RPCs, including cancellation teardown. */
    maxPending: number
    /** Maximum readers including source and renderer metadata lookups. */
    maxReaders: number
  }
  /** Browser spreadsheet parser and dense cell allocation limits. */
  excel: {
    /** Maximum source file bytes. */
    maxBytes: number
    /** Maximum combined rectangular cell area across worksheets. */
    maxCells: number
    /** Maximum parser Worker lifetime in milliseconds. */
    timeoutMs: number
  }
}

/** Deployment settings applied before document preview registration. */
export const Config: z<{ office?: Partial<Config['office']>; excel?: Partial<Config['excel']>; html?: Partial<Config['html']> }, Config> = z.object({
  html: z.object({ mode: z.union(['coding-tools', 'static', 'isolated-interactive'] as const).default('coding-tools') }),
  office: z.object({
    maxCachedEntries: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(8),
    maxCachedBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(64 * 1024 * 1024),
    maxPending: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(8),
    maxReaders: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(32),
  }),
  excel: z.object({
    maxBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(16 * 1024 * 1024),
    maxCells: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(250_000),
    timeoutMs: z.natural().min(1).max(2_147_483_647).default(15_000),
  }),
})
