import { describe, expect, test } from 'bun:test'
import { mergeApplicationSeed, optimisticApplicationSnapshot, rollbackApplicationSnapshot } from '../lib/application-state-machine'
import type { SiteApplicationContext, SiteApplicationSnapshot } from '../lib/contracts'

function snapshot(version: number, item = false): SiteApplicationSnapshot {
  return { version, cart: { items: item ? [{ itemId: 'room-a', quantity: 1 }] : [] }, booking: { selections: [] }, account: null }
}
function context(route: string, state: SiteApplicationSnapshot, siteId = 'site-a'): SiteApplicationContext {
  return {
    schemaVersion: 1,
    cacheIdentity: {
      host: siteId === 'site-a' ? 'alpha.fuma.co.ke' : 'beta.fuma.co.ke', platformId: 'platform', organizationId: 'org', workspaceId: 'workspace', siteId, ownerKey: `owner-${siteId}`, ownerGeneration: 1,
      releaseId: 'release-a', releaseHashSha256: 'a'.repeat(64), route, canonicalQuery: '', audience: { kind: 'member', memberId: 'member-a', accessFingerprintSha256: 'f'.repeat(64) },
      runtimeDeploymentVersion: '1.0.0', componentRegistryVersion: '1.0.0', rolloutPolicyVersion: 1,
    },
    member: { authenticated: true, memberIdentityId: 'identity-a', memberId: 'member-a', sessionId: 'session-a', displayName: 'Member A' },
    snapshot: state,
    cachePolicy: 'private',
  }
}

describe('FUMA-SITE-005 client application state machine', () => {
  test('preserves newer accepted cart/member state across same-realm client navigation', () => {
    const accepted = context('/menu', snapshot(2, true))
    const navigated = mergeApplicationSeed(accepted, context('/about', snapshot(0)))
    expect(navigated.cacheIdentity.route).toBe('/about')
    expect(navigated.snapshot).toEqual(snapshot(2, true))
  })

  test('resets state for a foreign site realm and accepts a newer server snapshot', () => {
    expect(mergeApplicationSeed(context('/menu', snapshot(2, true)), context('/menu', snapshot(0), 'site-b')).snapshot).toEqual(snapshot(0))
    expect(mergeApplicationSeed(context('/menu', snapshot(1)), context('/about', snapshot(3, true))).snapshot).toEqual(snapshot(3, true))
  })

  test('advances optimistic state once and rolls it back only while it is still current', () => {
    const previous = snapshot(4)
    const optimistic = optimisticApplicationSnapshot(previous, snapshot(99, true))
    expect(optimistic).toEqual(snapshot(5, true))
    const authority = context('/menu', previous)
    expect(rollbackApplicationSnapshot(context('/menu', optimistic), authority, 5, previous)?.snapshot).toEqual(previous)
    expect(rollbackApplicationSnapshot(context('/menu', snapshot(6, true)), authority, 5, previous)?.snapshot).toEqual(snapshot(6, true))
  })
})
