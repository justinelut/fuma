/**
 * A durable stamp for baked hole shells.
 *
 * THE DEFECT THIS EXISTS TO FIX.
 *
 * `publishState.ts` holds `let publishVersion = 0` in PROCESS MEMORY. `publishSite.ts` stamps every
 * baked hole shell with `getPublishVersion() + 1` into files on SHARED DISK, and `hole.ts` compares
 * the shell's `?v=` against that in-memory counter with strict equality, returning a stale sentinel
 * on mismatch.
 *
 * After a restart the counter is 0 while the shells on disk still say N, so EVERY hole returns the
 * stale sentinel. The existing comment reasons that "the next full page load will carry the correct
 * version" — it does not, because the next page load serves the SAME baked shell from disk, still
 * stamped N. It is a stuck state until somebody publishes again, and meanwhile every dynamic region
 * on every baked page is silently empty. With more than one process the counters differ permanently
 * and no restart fixes it.
 *
 * WHY A CONTENT HASH RATHER THAN A DURABLE COUNTER.
 *
 * A counter has to be stored, incremented and recovered, and every one of those is a place to get
 * it wrong — and a counter that is ever reset reintroduces exactly this bug, because a shell stamped
 * 5 compares as newer than a counter at 0 forever.
 *
 * The published site document is already persisted, so hashing it needs nothing new. It is identical
 * in every process and across every restart by construction, because it is derived from the bytes
 * rather than from a variable somebody has to maintain.
 *
 * It is also semantically MORE correct than a counter: it changes when the published content
 * changes, not when somebody happened to press publish. Republishing identical content leaves baked
 * shells valid, which is right — nothing about them is out of date.
 */

import { createHash } from 'node:crypto'

/** Length of the hex stamp. 16 hex characters is 64 bits. */
const STAMP_LENGTH = 16

/**
 * Serialise deterministically, with object keys sorted at every depth.
 *
 * THIS IS NOT TIDINESS — IT IS THE DIFFERENCE BETWEEN THIS WORKING AND BEING WORSE THAN THE BUG.
 *
 * The publish path stamps the in-memory draft document, whose keys are in insertion order. The hole
 * endpoint stamps the same document after a round trip through PostgreSQL, and `jsonb` SORTS KEYS.
 * So a plain `JSON.stringify` produces different bytes on the two sides, every shell would compare
 * as stale the moment it was baked, and every dynamic region would be permanently empty — the
 * original defect, made unconditional.
 *
 * Sorting at every depth makes the stamp a property of the CONTENT rather than of how it happened to
 * be serialised, so both sides agree by construction.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    // Array ORDER is content, not formatting, so it is preserved.
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * The durable stamp for a published site document.
 *
 * Accepts either the parsed document or its serialised form: both are canonicalised first, so a
 * document that has been through the database and one that has not produce the same stamp.
 */
export function stampForPublishedSite(site: unknown): string {
  const canonical = typeof site === 'string' ? canonicalJson(safeParse(site)) : canonicalJson(site)
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, STAMP_LENGTH)
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value) } catch { return value }
}

export type ShellVerdict =
  /** The shell was baked from the content currently published. */
  | 'fresh'
  /** The shell was baked from different content and must be refreshed. */
  | 'stale'
  /**
   * The shell predates durable stamping — it carries the old numeric counter.
   *
   * Served rather than refused. See `judgeShellStamp` for why.
   */
  | 'legacy'

/** A stamp written by the pre-fix code: the in-memory counter, so purely digits. */
const LEGACY_NUMERIC = /^[0-9]+$/

/**
 * Classify a shell's stamp.
 *
 * A LEGACY NUMERIC STAMP IS REPORTED AS SUCH RATHER THAN JUDGED HERE, because the right comparison
 * for it is the ORIGINAL one — the numeric counter.
 *
 * That is deliberate and was a correction. Comparing a legacy stamp against a content hash can only
 * ever fail, so treating legacy shells as stale would empty every dynamic region on every
 * already-baked page: precisely the outage being fixed, caused by the fix. Accepting them
 * unconditionally is the opposite error — it disables staleness detection for shells where it
 * currently works correctly within a process run.
 *
 * So legacy shells keep exactly the behaviour they have today, warts and all, and they cease to
 * exist at the next publish because every shell is then re-baked with a durable stamp. The defect is
 * fixed for every shell baked after this ships, and nothing that works today changes.
 *
 * A malformed or absent stamp is stale, never trusted — that path is reachable by a crafted request
 * and must not be a way to force a serve.
 */
export function judgeShellStamp(shellStamp: string, currentStamp: string): ShellVerdict {
  const shell = shellStamp.trim()
  if (shell.length === 0) return 'stale'
  if (LEGACY_NUMERIC.test(shell)) return 'legacy'
  if (currentStamp.length !== STAMP_LENGTH) return 'stale'
  return shell === currentStamp ? 'fresh' : 'stale'
}

/**
 * Whether the hole endpoint may render real content for this shell.
 *
 * `legacyVersion` is the in-memory counter, consulted ONLY for a legacy numeric stamp so that
 * pre-existing shells behave exactly as they did before durable stamping. New shells never reach it.
 */
export function mayServeShell(
  shellStamp: string,
  currentStamp: string,
  legacyVersion: number,
): boolean {
  const verdict = judgeShellStamp(shellStamp, currentStamp)
  if (verdict === 'legacy') return shellStamp.trim() === String(legacyVersion)
  return verdict === 'fresh'
}

export type ComparatorProblem = Readonly<{
  code: 'in-memory-counter' | 'stamp-not-durable'
  message: string
}>

/**
 * Guard against the defect being reintroduced.
 *
 * The single edit that undoes all of this is wiring the comparison back to an in-memory counter,
 * which reads as a simplification and is a silent outage after the next restart.
 */
export function reviewComparator(source: string): readonly ComparatorProblem[] {
  const problems: ComparatorProblem[] = []
  if (/getPublishVersion\s*\(\s*\)/.test(source)) {
    problems.push(Object.freeze({
      code: 'in-memory-counter' as const,
      message:
        'This compares against the in-memory publish counter, which is 0 after a restart while '
        + 'shells on disk still carry their old value — so every hole returns the stale sentinel '
        + 'and every dynamic region is silently empty until somebody publishes again.',
    }))
  }
  if (!/stampForPublishedSite|judgeShellStamp|mayServeShell/.test(source)) {
    problems.push(Object.freeze({
      code: 'stamp-not-durable' as const,
      message:
        'No durable stamp is consulted, so the freshness decision cannot survive a restart or a '
        + 'second process.',
    }))
  }
  return Object.freeze(problems)
}

/**
 * Cache keyed on the document object itself.
 *
 * A publish builds one snapshot per page over a single shared, frozen site object, so hashing it
 * per page would repeat identical work across every page of a large site. Keyed weakly so caching
 * cannot keep a published document alive.
 */
const stampCache = new WeakMap<object, string>()

/** The stamp for a site document, computed once per document object. */
export function stampForSiteDocument(site: object): string {
  const cached = stampCache.get(site)
  if (cached !== undefined) return cached
  const stamp = stampForPublishedSite(site)
  stampCache.set(site, stamp)
  return stamp
}
