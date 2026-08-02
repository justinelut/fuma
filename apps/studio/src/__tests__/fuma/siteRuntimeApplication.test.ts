import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import type { RuntimeRouteArtifact } from '../../../server/fuma/publishing/runtimeTree/contracts'
import {
  MemorySiteRuntimeMutationReceiptRepository,
  MemorySiteRuntimeRolloutRepository,
  SiteApplicationError,
  SiteRuntimeApplicationAuthority,
  emptyApplicationSnapshot,
  type SiteApplicationContext,
  type SiteApplicationSnapshot,
  type SiteRuntimeExactBinding,
  type SiteRuntimeLegacyDocument,
} from '../../../server/fuma/siteRuntime'
import type { SiteRuntimeCacheIdentity } from '../../../server/fuma/siteRuntime/contracts'

const at = '2026-07-30T12:00:00.000Z'
const binding: SiteRuntimeExactBinding = Object.freeze({
  host: 'alpha.trimly.co.ke', platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', ownerGeneration: 3, releaseId: 'release-react', releaseHashSha256: 'a'.repeat(64),
})
const audience = Object.freeze({ kind: 'member' as const, memberId: 'member-a', accessFingerprintSha256: 'f'.repeat(64) })
const member = Object.freeze({ authenticated: true as const, memberIdentityId: 'identity-a', memberId: 'member-a', sessionId: 'session-a', displayName: 'Member A' })
const identity: SiteRuntimeCacheIdentity = Object.freeze({
  ...binding, route: '/book', canonicalQuery: '', audience, runtimeDeploymentVersion: '1.0.0', componentRegistryVersion: '1.0.0', rolloutPolicyVersion: 1,
})

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function legacy(html = '<main>Legacy booking</main>'): SiteRuntimeLegacyDocument {
  return {
    releaseId: 'release-legacy', route: '/book', html, contentHashSha256: hash(html), scripts: [{ logicalPath: '/legacy.js', source: 'globalThis.legacyReady=true', contentHashSha256: hash('globalThis.legacyReady=true') }],
    csp: "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  }
}
function route(semanticHash = hash('<main>Legacy booking</main>')): RuntimeRouteArtifact {
  return {
    route: { route: '/book', semanticHtmlPath: '/book.html' },
    artifactReferences: [{ role: 'semantic-html', logicalPath: '/book.html', contentHashSha256: semanticHash }],
  } as unknown as RuntimeRouteArtifact
}

function setup() {
  const rollouts = new MemorySiteRuntimeRolloutRepository()
  const receipts = new MemorySiteRuntimeMutationReceiptRepository()
  let calls = 0
  let state: SiteApplicationSnapshot = emptyApplicationSnapshot()
  const authority = new SiteRuntimeApplicationAuthority({
    rollouts,
    receipts,
    now: () => new Date(at),
    legacy: { async read(_binding, releaseId, requestedRoute) { const value = legacy(); return { ...value, releaseId, route: requestedRoute } } },
    members: {
      async resolve({ memberSessionToken }) {
        if (memberSessionToken !== 'token-a'.repeat(5)) return { audience: { kind: 'public', memberId: null, accessFingerprintSha256: '0'.repeat(64) }, member: { authenticated: false, memberIdentityId: null, memberId: null, sessionId: null, displayName: null }, snapshot: emptyApplicationSnapshot() }
        return { audience, member, snapshot: state }
      },
    },
    mutations: {
      async mutate({ operation }) {
        calls += 1
        if (operation.expectedVersion !== state.version) throw new SiteApplicationError('stale', 'State version changed.')
        state = { ...state, version: state.version + 1, cart: { items: [{ itemId: 'room-a', quantity: 1 }] } }
        return state
      },
    },
  })
  return { authority, rollouts, receipts, calls: () => calls, state: () => state }
}

function context(authority: SiteRuntimeApplicationAuthority): Promise<SiteApplicationContext> {
  return authority.project(binding, 'token-a'.repeat(5)).then((projection) => authority.context(identity, projection))
}
function mutation(application: SiteApplicationContext, overrides: Record<string, unknown> = {}) {
  return {
    host: binding.host,
    memberSessionToken: 'token-a'.repeat(5),
    context: application,
    operation: {
      mutationId: 'mutation-a', idempotencyKey: 'site-mutation:key-a', kind: 'cart.update', expectedVersion: 0,
      payload: { itemId: 'room-a', quantity: 1 }, issuedAt: at, ...overrides,
    },
  }
}

describe('FUMA-SITE-005 application state and legacy compatibility', () => {
  test('projects exact member context and marks authenticated state private', async () => {
    const { authority } = setup()
    const projected = await context(authority)
    expect(projected.cacheIdentity).toEqual(identity)
    expect(projected.member).toEqual(member)
    expect(projected.cachePolicy).toBe('private')
    const publicProjection = await authority.project(binding, 'foreign-token'.repeat(5))
    expect(authority.context({ ...identity, audience: publicProjection.audience }, publicProjection).cachePolicy).toBe('public')
  })

  test('advances one exact mutation, returns immutable replay, and denies changed replay evidence', async () => {
    const fixture = setup()
    const application = await context(fixture.authority)
    const first = await fixture.authority.mutate(binding, mutation(application))
    expect(first).toMatchObject({ accepted: true, duplicate: false, mutationId: 'mutation-a', snapshot: { version: 1 } })
    expect(fixture.calls()).toBe(1)
    const replay = await fixture.authority.mutate(binding, mutation(application))
    expect(replay.duplicate).toBe(true)
    expect(fixture.calls()).toBe(1)
    await expect(fixture.authority.mutate(binding, mutation(application, { payload: { itemId: 'room-b', quantity: 2 } }))).rejects.toMatchObject({ code: 'replay' })
  })

  test('denies foreign-host, unauthenticated, expired, and stale-version mutations without accepted receipt', async () => {
    const fixture = setup()
    const application = await context(fixture.authority)
    await expect(fixture.authority.mutate({ ...binding, siteId: 'site-b' }, mutation(application))).rejects.toMatchObject({ code: 'scope' })
    await expect(fixture.authority.mutate(binding, { ...mutation(application), memberSessionToken: null })).rejects.toMatchObject({ code: 'unauthenticated' })
    await expect(fixture.authority.mutate(binding, mutation(application, { issuedAt: '2026-07-30T11:00:00.000Z' }))).rejects.toMatchObject({ code: 'stale' })
    await fixture.authority.mutate(binding, mutation(application))
    await expect(fixture.authority.mutate(binding, mutation({ ...application, snapshot: fixture.state() }, { mutationId: 'mutation-b', idempotencyKey: 'site-mutation:key-b', expectedVersion: 0 }))).rejects.toMatchObject({ code: 'stale' })
    expect(fixture.receipts.values.size).toBe(1)
  })

  test('cuts over, shadow-compares, falls back, and rolls a route back without invoking mutation state', async () => {
    const fixture = setup()
    await fixture.authority.setPolicy(binding, { route: '/book', target: 'react', shadow: 'compare', fallback: 'legacy', legacyReleaseId: 'release-legacy', version: 1 }, null)
    const matched = await fixture.authority.delivery(binding, route(), await fixture.authority.policy(binding, '/book'))
    expect(matched).toMatchObject({ selected: 'react', reason: 'shadow-match', shadowParity: 'matched' })
    const fallback = await fixture.authority.delivery(binding, route('b'.repeat(64)), await fixture.authority.policy(binding, '/book'))
    expect(fallback).toMatchObject({ selected: 'legacy', reason: 'shadow-mismatch-fallback', shadowParity: 'mismatched' })
    await fixture.authority.setPolicy(binding, { route: '/book', target: 'legacy', shadow: 'off', fallback: 'legacy', legacyReleaseId: 'release-legacy', version: 2 }, 1)
    expect((await fixture.authority.delivery(binding, route(), await fixture.authority.policy(binding, '/book'))).selected).toBe('legacy')
    expect(fixture.calls()).toBe(0)
    expect(fixture.state().version).toBe(0)
  })

  test('rejects unretained-policy shapes and authority-bearing legacy markup or scripts', async () => {
    const fixture = setup()
    await expect(fixture.authority.setPolicy(binding, { route: '/book', target: 'legacy', shadow: 'off', fallback: 'legacy', legacyReleaseId: null, version: 1 }, null)).rejects.toMatchObject({ code: 'legacy-unavailable' })
    const hostileHtml = new SiteRuntimeApplicationAuthority({
      rollouts: { async get() { return { route: '/book', target: 'legacy', shadow: 'off', fallback: 'legacy', legacyReleaseId: 'release-legacy', version: 1 } }, async put() { return true } },
      receipts: new MemorySiteRuntimeMutationReceiptRepository(),
      legacy: { async read() { return legacy('<script>alert(1)</script>') } },
    })
    await expect(hostileHtml.delivery(binding, route())).rejects.toMatchObject({ code: 'legacy-unavailable' })
    const hostileIife = new SiteRuntimeApplicationAuthority({
      rollouts: { async get() { return { route: '/book', target: 'legacy', shadow: 'off', fallback: 'legacy', legacyReleaseId: 'release-legacy', version: 1 } }, async put() { return true } },
      receipts: new MemorySiteRuntimeMutationReceiptRepository(),
      legacy: { async read() { const value = legacy(); return { ...value, scripts: [{ ...value.scripts[0]!, source: 'eval("bad")', contentHashSha256: hash('eval("bad")') }] } } },
    })
    await expect(hostileIife.delivery(binding, route())).rejects.toMatchObject({ code: 'legacy-unavailable' })
  })
})
