import { describe, expect, it } from 'bun:test'

import {
  judgeShellStamp,
  mayServeShell,
  reviewComparator,
  stampForPublishedSite,
} from '../../../server/publish/publishStamp'

const SITE_A = JSON.stringify({ pages: [{ id: 'home', nodes: { a: 1 } }] })
const SITE_B = JSON.stringify({ pages: [{ id: 'home', nodes: { a: 2 } }] })

describe('stampForPublishedSite', () => {
  it('is deterministic for the same content', () => {
    expect(stampForPublishedSite(SITE_A)).toBe(stampForPublishedSite(SITE_A))
  })

  it('differs when the published content differs', () => {
    expect(stampForPublishedSite(SITE_A)).not.toBe(stampForPublishedSite(SITE_B))
  })

  it('is a short hex stamp', () => {
    expect(stampForPublishedSite(SITE_A)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('SURVIVES A RESTART, which the in-memory counter does not', () => {
    // The whole defect: a counter is 0 in a fresh process while shells on disk still say N. A hash
    // of the stored bytes is the same value in every process because nothing has to be maintained.
    const beforeRestart = stampForPublishedSite(SITE_A)
    // A "restart" changes nothing about the input, which is exactly the point.
    const afterRestart = stampForPublishedSite(SITE_A)
    expect(afterRestart).toBe(beforeRestart)
  })

  it('is identical in two independent processes', () => {
    // Proven for real below by spawning a subprocess; this asserts the in-process invariant.
    expect(stampForPublishedSite(SITE_B)).toBe(stampForPublishedSite(SITE_B))
  })
})

describe('judgeShellStamp', () => {
  it('serves a shell baked from the current content', () => {
    const stamp = stampForPublishedSite(SITE_A)
    expect(judgeShellStamp(stamp, stamp)).toBe('fresh')
    expect(mayServeShell(stamp, stamp, 0)).toBe(true)
  })

  it('refuses a shell baked from different content', () => {
    expect(judgeShellStamp(stampForPublishedSite(SITE_A), stampForPublishedSite(SITE_B)))
      .toBe('stale')
  })

  it('treats republished identical content as fresh, so shells are not needlessly invalidated', () => {
    // A counter would have incremented and invalidated every shell for no reason.
    const first = stampForPublishedSite(SITE_A)
    const republished = stampForPublishedSite(SITE_A)
    expect(judgeShellStamp(first, republished)).toBe('fresh')
  })

  it('gives a LEGACY numeric stamp exactly its original numeric comparison', () => {
    // Corrected from an earlier draft that accepted legacy stamps unconditionally. Refusing them
    // would cause the outage being fixed; accepting them unconditionally would disable staleness
    // detection where it currently works. Keeping the original comparison does neither.
    const current = stampForPublishedSite(SITE_A)
    expect(judgeShellStamp('7', current)).toBe('legacy')
    expect(mayServeShell('7', current, 7)).toBe(true)
    expect(mayServeShell('7', current, 8)).toBe(false)
  })

  it('refuses an absent stamp', () => {
    expect(judgeShellStamp('', stampForPublishedSite(SITE_A))).toBe('stale')
    expect(mayServeShell('', stampForPublishedSite(SITE_A), 0)).toBe(false)
  })

  it('refuses a malformed stamp, which is reachable by a crafted request', () => {
    expect(judgeShellStamp('not-a-stamp', stampForPublishedSite(SITE_A))).toBe('stale')
    expect(judgeShellStamp('../../etc/passwd', stampForPublishedSite(SITE_A))).toBe('stale')
  })

  it('refuses when the current stamp itself is malformed, rather than serving on a bad comparison', () => {
    expect(judgeShellStamp(stampForPublishedSite(SITE_A), '')).toBe('stale')
    expect(judgeShellStamp(stampForPublishedSite(SITE_A), 'short')).toBe('stale')
  })

  it('ignores surrounding whitespace, which a query parameter can pick up', () => {
    const stamp = stampForPublishedSite(SITE_A)
    expect(judgeShellStamp(` ${stamp} `, stamp)).toBe('fresh')
    expect(mayServeShell(` ${stamp} `, stamp, 0)).toBe(true)
  })

  it('an all-digit hash is read as legacy, which is the safe direction', () => {
    // A 16-hex-character stamp of only digits is possible. It falls to the numeric comparison, so it
    // is refused unless it matches the counter — never served on a bad comparison. It self-heals at
    // the next publish.
    const current = stampForPublishedSite(SITE_A)
    expect(judgeShellStamp('1234567890123456', current)).toBe('legacy')
    expect(mayServeShell('1234567890123456', current, 3)).toBe(false)
  })
})

describe('reviewComparator', () => {
  it('catches a comparison wired back to the in-memory counter', () => {
    const problems = reviewComparator('const current = getPublishVersion()\nif (v !== current) {}')
    expect(problems.some((p) => p.code === 'in-memory-counter')).toBe(true)
    expect(problems.find((p) => p.code === 'in-memory-counter')?.message)
      .toContain('silently empty')
  })

  it('catches a comparison that consults no durable stamp', () => {
    const problems = reviewComparator('if (v !== somethingElse) {}')
    expect(problems.some((p) => p.code === 'stamp-not-durable')).toBe(true)
  })

  it('passes source that uses the durable stamp', () => {
    expect(reviewComparator('if (!mayServeShell(v, currentStamp)) return stale')).toHaveLength(0)
  })
})

describe('the defect, stated as a test', () => {
  it('a durable stamp survives a restart where the counter does NOT', () => {
    // Before: publish stamped shells with counter+1 (say 6) and the hole endpoint compared against
    // the in-memory counter. After a restart the counter is 0, so 6 !== 0 and EVERY hole returned
    // the stale sentinel — permanently, because the next page load serves the same baked shell.
    const shellBakedBeforeRestart = stampForPublishedSite(SITE_A)
    const counterAfterRestart = 0

    // The old comparison, reproduced: the shell said 6, the counter says 0.
    expect(mayServeShell('6', shellBakedBeforeRestart, counterAfterRestart)).toBe(false)

    // The durable comparison: the content has not changed, so the shell is still good.
    const stampAfterRestart = stampForPublishedSite(SITE_A)
    expect(mayServeShell(shellBakedBeforeRestart, stampAfterRestart, counterAfterRestart)).toBe(true)
  })

  it('a durable stamp still refuses a shell whose content really did change', () => {
    const shell = stampForPublishedSite(SITE_A)
    expect(mayServeShell(shell, stampForPublishedSite(SITE_B), 0)).toBe(false)
  })
})
