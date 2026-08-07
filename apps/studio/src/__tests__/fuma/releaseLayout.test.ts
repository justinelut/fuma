/**
 * Source workspace, build snapshot and release.
 *
 * The rules asserted here each prevent a failure that presents as something else: two active
 * releases look like content changing at random, and a release whose snapshot is missing looks
 * like a mystery rather than a missing record.
 */

import { describe, it, expect } from 'bun:test'
import {
  RELEASE_LOGICAL_ROOT,
  RELEASE_OBJECT_CLASS,
  RELEASE_STATES,
  isRollbackTarget,
  isServing,
  releaseObjectPrefix,
  reviewReleases,
  sameInput,
  type BuildSnapshot,
  type Release,
} from '../../../server/fuma/publish/releaseLayout'
import { TENANT_OBJECT_CLASSES } from '../../../server/fuma/tenantObjects/contracts'

const snapshot = (id: string, hash = 'h1', site = 'site-a'): BuildSnapshot => Object.freeze({
  snapshotId: id,
  siteDocumentId: site,
  sourceHash: hash,
  modulePaths: Object.freeze(['app/page.tsx']),
  createdAt: '2026-01-01T00:00:00.000Z',
})

const release = (
  id: string,
  state: Release['state'],
  snapshotId = 'snap-1',
  extra: Partial<Release> = {},
): Release => Object.freeze({
  releaseId: id,
  siteDocumentId: 'site-a',
  snapshotId,
  state,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

describe('the layout reuses what the tenant inventory already declares', () => {
  it('uses the existing publish-release object class', () => {
    // Inventing a parallel object class would mean quota measurement and per-tenant purge would
    // each have to learn about two layouts.
    expect(TENANT_OBJECT_CLASSES).toContain(RELEASE_OBJECT_CLASS)
  })

  it('uses the logical root the inventory declares', () => {
    expect(RELEASE_LOGICAL_ROOT).toBe('publish/releases/')
  })

  it('puts the site before the release in the key', () => {
    // Site-first makes one tenant's releases contiguous, so a purge or a quota measurement is a
    // prefix operation rather than a scan.
    const prefix = releaseObjectPrefix('site-a', 'rel-1')
    expect(prefix).toBe('publish/releases/site-a/rel-1/')
    expect(prefix.indexOf('site-a')).toBeLessThan(prefix.indexOf('rel-1'))
  })

  it('keeps two sites releases apart', () => {
    expect(releaseObjectPrefix('site-a', 'rel-1'))
      .not.toBe(releaseObjectPrefix('site-b', 'rel-1'))
  })
})

describe('built is not live', () => {
  it('serves only an active release', () => {
    // The whole point of blue/green: a build finishing is not a decision to ship it.
    expect(isServing(release('r', 'active'))).toBe(true)
    for (const state of ['building', 'built', 'failed', 'superseded'] as const) {
      expect(isServing(release('r', state))).toBe(false)
    }
  })

  it('declares every state exactly once', () => {
    expect(new Set(RELEASE_STATES).size).toBe(RELEASE_STATES.length)
    expect(RELEASE_STATES).toContain('built')
    expect(RELEASE_STATES).toContain('active')
  })
})

describe('rollback targets are only what actually served', () => {
  it('accepts a superseded release', () => {
    expect(isRollbackTarget(release('r', 'superseded'))).toBe(true)
  })

  it('refuses a failed release', () => {
    // Rolling back to something that never served would take the site down, and the mistake would
    // be made during an incident when nobody has time to check.
    expect(isRollbackTarget(release('r', 'failed', 'snap-1', { failureReason: 'build failed' })))
      .toBe(false)
  })

  it('refuses a release still building', () => {
    expect(isRollbackTarget(release('r', 'building'))).toBe(false)
  })
})

describe('the review catches what presents as something else', () => {
  it('refuses two active releases', () => {
    const problems = reviewReleases(
      [release('r1', 'active'), release('r2', 'active')],
      [snapshot('snap-1')],
    )
    expect(problems.some((problem) => problem.code === 'two-active-releases')).toBe(true)
    expect(problems.find((p) => p.code === 'two-active-releases')?.message)
      .toContain('at random')
  })

  it('accepts exactly one active release', () => {
    const problems = reviewReleases(
      [release('r1', 'active'), release('r2', 'superseded')],
      [snapshot('snap-1')],
    )
    expect(problems).toEqual([])
  })

  it('refuses a release whose snapshot does not exist', () => {
    // Without the snapshot the source that produced it cannot be recovered, so it can neither be
    // rebuilt nor explained.
    const problems = reviewReleases([release('r1', 'active', 'missing-snap')], [snapshot('snap-1')])
    expect(problems.some((problem) => problem.code === 'release-without-snapshot')).toBe(true)
  })

  it('refuses a failed release with no reason', () => {
    const problems = reviewReleases([release('r1', 'failed')], [snapshot('snap-1')])
    expect(problems.some((problem) => problem.code === 'failed-without-reason')).toBe(true)
  })

  it('accepts a failed release that records why', () => {
    const problems = reviewReleases(
      [release('r1', 'failed', 'snap-1', { failureReason: 'tsc exited 2' })],
      [snapshot('snap-1')],
    )
    expect(problems).toEqual([])
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewReleases(
      [release('r1', 'active', 'missing'), release('r2', 'active', 'missing')],
      [],
    )
    expect(problems.length).toBeGreaterThan(1)
  })
})

describe('a snapshot is identified by its content', () => {
  it('treats identical source as the same input', () => {
    // So a rebuild of unchanged source is recognisable and need not be built again.
    expect(sameInput(snapshot('snap-1', 'hash-x'), snapshot('snap-2', 'hash-x'))).toBe(true)
  })

  it('treats changed source as a different input', () => {
    expect(sameInput(snapshot('snap-1', 'hash-x'), snapshot('snap-1', 'hash-y'))).toBe(false)
  })

  it('never treats two sites source as the same input', () => {
    // Identical source in two tenants is still two builds: they carry different site identity and
    // sharing output between them would serve one tenant's build to the other.
    expect(sameInput(
      snapshot('snap-1', 'hash-x', 'site-a'),
      snapshot('snap-2', 'hash-x', 'site-b'),
    )).toBe(false)
  })
})
