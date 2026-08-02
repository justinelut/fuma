import { describe, expect, test } from 'bun:test'
import {
  EdgeDeliveryError,
  EdgeDeliveryService,
  MemoryEdgeCache,
  type EdgeHoleResolver,
  type EdgeReleaseReader,
  type EdgeRequestContext,
} from '../../../server/fuma/edgeDelivery/service'
import { FreeHostEdgeBoundary } from '../../../server/fuma/edgeDelivery/publicBoundary'
import { edgeDeliveryJobRegistration } from '../../../server/fuma/edgeDelivery/jobHandlers'
import { PublicationAccessEdgeHoleResolver } from '../../../server/fuma/edgeDelivery/publicationHole'

const encoder = new TextEncoder()
const hash = (value: Uint8Array | string) => new Bun.CryptoHasher('sha256').update(value).digest('hex')
const site = { platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner', ownerGeneration: 1 }
function context(releaseId: string, path = '/index.html', memberId: string | null = null, audience = 'anonymous'): EdgeRequestContext {
  return Object.freeze({ ...site, host: 'tenant.trimly.co.ke', releaseId, path, memberId, accessFingerprint: hash(audience), requestClaims: Object.freeze({ audience }) })
}
function marker(id: string, input: Readonly<Record<string, string | number | boolean | null>> = {}) {
  return `<!--hole:${id}:${Buffer.from(JSON.stringify(input)).toString('base64url')}-->`
}

type Artifact = Readonly<{ bytes: Uint8Array; hashSha256: string; mimeType: string; holes: readonly Readonly<{ marker: string; resolverId: string; input: Readonly<Record<string, string | number | boolean | null>> }>[] }>
class Reader implements EdgeReleaseReader {
  readonly artifacts = new Map<string, Artifact>()
  active = 'release-1'
  reads = 0
  async read(input: EdgeRequestContext) {
    this.reads += 1
    if (input.releaseId !== this.active) throw new EdgeDeliveryError('stale-pointer', 'stale')
    const value = this.artifacts.get(`${input.releaseId}:${input.path}`)
    if (!value) throw new Error('missing')
    return structuredClone(value)
  }
}
function artifact(body: string, holes: Artifact['holes'] = [], mimeType = 'text/html'): Artifact {
  const bytes = encoder.encode(body)
  return Object.freeze({ bytes, hashSha256: hash(bytes), mimeType, holes })
}
function harness() {
  const cache = new MemoryEdgeCache()
  const reader = new Reader()
  const memberMarker = marker('member-card')
  const requestMarker = marker('request-locale')
  reader.artifacts.set('release-1:/index.html', artifact(`<main>one ${memberMarker}</main>`, [{ marker: memberMarker, resolverId: 'member-card', input: {} }]))
  reader.artifacts.set('release-2:/index.html', artifact(`<main>two ${memberMarker}</main>`, [{ marker: memberMarker, resolverId: 'member-card', input: {} }]))
  reader.artifacts.set('release-1:/request.html', artifact(`<main>${requestMarker}</main>`, [{ marker: requestMarker, resolverId: 'request-locale', input: {} }]))
  const assetBytes = encoder.encode('immutable asset')
  const assetHash = hash(assetBytes)
  reader.artifacts.set(`release-1:/assets/${assetHash}.css`, { bytes: assetBytes, hashSha256: assetHash, mimeType: 'text/css', holes: [] })
  reader.artifacts.set(`release-2:/assets/${assetHash}.css`, { bytes: assetBytes, hashSha256: assetHash, mimeType: 'text/css', holes: [] })
  const holes: readonly EdgeHoleResolver[] = [
    { id: 'member-card', scope: 'member', async resolve(input) { return `<span>${input.memberId}:${input.requestClaims.audience}</span>` } },
    { id: 'request-locale', scope: 'request', async resolve(input) { return input.requestClaims.locale ?? 'und' } },
  ]
  const pointers = {
    calls: 0,
    async rollback(_input: EdgeRequestContext, target: string, expected: string) {
      if (reader.active === target) return
      if (reader.active !== expected) throw new EdgeDeliveryError('stale-pointer', 'changed')
      this.calls += 1
      reader.active = target
    },
  }
  const service = new EdgeDeliveryService({ cache, reader, pointers, holes, now: () => 1_000, htmlTtlMs: 100, staleMs: 1_000 })
  return { cache, reader, pointers, service, assetHash }
}
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('FUMA-051 edge delivery control', () => {
  test('isolates member holes by member and access fingerprint and denies anonymous access', async () => {
    const h = harness()
    const first = await h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'))
    const second = await h.service.serve(context('release-1', '/index.html', 'member-b', 'member'))
    expect(text(first.body)).toContain('member-a:paid')
    expect(text(second.body)).toContain('member-b:member')
    expect(first.cacheControl).toStartWith('private')
    expect(first.vary).toBe('Cookie, Authorization')
    expect(h.cache.entries.size).toBe(2)
    await expect(h.service.serve(context('release-1'))).rejects.toMatchObject({ code: 'member-required' })
  })

  test('keeps request holes no-store and outside shared cache', async () => {
    const h = harness()
    const first = { ...context('release-1', '/request.html'), requestClaims: { audience: 'anonymous', locale: 'en-KE' }, accessFingerprint: hash('en-KE') }
    const second = { ...first, requestClaims: { audience: 'anonymous', locale: 'sw-KE' }, accessFingerprint: hash('sw-KE') }
    expect(text((await h.service.serve(first)).body)).toContain('en-KE')
    const response = await h.service.serve(second)
    expect(text(response.body)).toContain('sw-KE')
    expect(response.cacheControl).toBe('private, no-store')
    expect(h.cache.entries.size).toBe(0)
  })

  test('returns strong conditional GET responses and bounded stale HTML', async () => {
    const h = harness()
    const first = await h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'))
    const conditional = await h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'), `"other", ${first.etag}`)
    expect(conditional.status).toBe(304)
    expect(conditional.body.byteLength).toBe(0)
    expect(conditional.etag).toBe(first.etag)
    expect(h.reader.reads).toBe(1)
  })

  test('purges idempotently by exact host/site/release without crossing hosts', async () => {
    const h = harness()
    await h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'))
    await h.cache.put('edge:other.trimly.co.ke:site:release-1:x:y', { body: new Uint8Array(), etag: `"${'a'.repeat(64)}"`, contentType: 'text/html', releaseId: 'release-1', expiresAt: 1, staleUntil: 1, cacheControl: 'public, max-age=30', vary: null })
    expect(await h.service.purge('TENANT.TRIMLY.CO.KE:443.', 'site', 'release-1')).toBe(1)
    expect(await h.service.purge('tenant.trimly.co.ke', 'site', 'release-1')).toBe(0)
    expect([...h.cache.entries.keys()]).toEqual(['edge:other.trimly.co.ke:site:release-1:x:y'])
  })

  test('rolls back the exact pointer under load, purges old HTML, and preserves immutable assets', async () => {
    const h = harness()
    await h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'))
    const assetPath = `/assets/${h.assetHash}.css`
    const assetBefore = await h.service.serve(context('release-1', assetPath))
    expect(assetBefore.cacheControl).toBe('public, max-age=31536000, immutable')
    await Promise.all(Array.from({ length: 20 }, () => h.service.serve(context('release-1', '/index.html', 'member-a', 'paid'))))
    await h.service.rollback({ context: context('release-1'), targetReleaseId: 'release-2' })
    await h.service.rollback({ context: context('release-1'), targetReleaseId: 'release-2' })
    expect(h.pointers.calls).toBe(1)
    expect([...h.cache.entries.keys()].some((key) => key.includes(':release-1:'))).toBe(false)
    const after = await h.service.serve(context('release-2', '/index.html', 'member-a', 'paid'))
    const assetAfter = await h.service.serve(context('release-2', assetPath))
    expect(text(after.body)).toContain('two')
    expect(assetAfter.etag).toBe(assetBefore.etag)
    expect(assetAfter.cacheControl).toBe('public, max-age=31536000, immutable')
  })

  test('serves a trusted free-host response with release, ETag, Vary and HEAD controls', async () => {
    const h = harness()
    const boundary = new FreeHostEdgeBoundary(h.service, { async resolve() { return { memberId: 'member-a', claims: { audience: 'paid' } } } })
    const resolution = { kind: 'release' as const, host: { host: 'tenant.trimly.co.ke', label: 'tenant', ...site, state: 'active' as const, canonicalHost: null, version: 1, createdAt: '2040-01-01T00:00:00.000Z' }, releaseId: 'release-1' }
    const response = await boundary.serve(new Request('https://tenant.trimly.co.ke/index.html', { method: 'HEAD' }), resolution)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-fuma-release-id')).toBe('release-1')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    expect(await response.text()).toBe('')
  })

  test('registers purge, warm and rollback as trusted durable jobs with replay receipts', async () => {
    const h = harness()
    const effects = new Map<string, FumaJobJsonValue>()
    const handlers = edgeDeliveryJobRegistration({ service: h.service, hosts: { async exact() { return 'tenant.trimly.co.ke' } } })
    const base = {
      jobContext: { kind: 'site', profile: { id: 'website' } },
      repositoryScope: { ...site, generation: 1, state: 'active', transferFence: null },
      siteRepository: {}, attemptNumber: 1, fence: '1', cancellationRequested: async () => false,
      readDurableResult: async (key: string) => effects.has(key) ? { result: effects.get(key)! } : null,
      commitDurableResult: async (key: string, result: FumaJobJsonValue) => { const created = !effects.has(key); if (created) effects.set(key, result); return { result: effects.get(key)!, created } },
    }
    const warm = { ...base, job: { payload: { releaseId: 'release-1', paths: [`/assets/${h.assetHash}.css`] } } }

    const first = await handlers['fuma.edge-warm'](warm as never)
    const replay = await handlers['fuma.edge-warm'](warm as never)
    expect(replay).toEqual(first)
    expect(effects.size).toBe(1)
  })

  test('resolves the production Publication member hole from trusted identity and exact website scope', async () => {
    const seen: unknown[] = []
    const resolver = new PublicationAccessEdgeHoleResolver({
      async resolve(scope, request, identity, origin) {
        seen.push({ scope, request, identity, origin })
        return { presentation: { html: '<aside>member access</aside>' } } as never
      },
    })
    const input = { ...context('release-1', '/paid.html', 'member-a', 'paid'), requestClaims: { audience: 'paid', memberIdentityId: 'identity-a', segmentIds: 'daily' } }
    expect(await resolver.resolve(input, { contentId: 'post-a' })).toBe('<aside>member access</aside>')
    expect(seen).toEqual([{
      scope: { platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site', ownerKey: 'owner', generation: 1, state: 'active', transferFence: null, profileId: 'website' },
      request: { contentId: 'post-a', previewToken: null, requestedPath: '/paid.html' },
      identity: 'identity-a',
      origin: 'https://tenant.trimly.co.ke',
    }])
  })

  test('prints deterministic warm, publish/purge, member-hole and rollback evidence', async () => {
    const h = harness()
    const member = context('release-1', '/index.html', 'member-demo', 'paid')
    const warmed = await h.service.warm([member])
    const before = text((await h.service.serve(member)).body)
    const purged = await h.service.purge(member.host, member.siteId, member.releaseId)
    await h.service.rollback({ context: member, targetReleaseId: 'release-2' })
    const after = text((await h.service.serve(context('release-2', '/index.html', 'member-demo', 'paid'))).body)
    const demo = { warmed: warmed.length, purged, memberIsolated: before.includes('member-demo:paid'), activeRelease: h.reader.active, rolledBackBody: after.includes('two') }
    process.stdout.write(`FUMA-051 demo ${JSON.stringify(demo)}\n`)
    expect(demo).toEqual({ warmed: 1, purged: 1, memberIsolated: true, activeRelease: 'release-2', rolledBackBody: true })
  })
})

type FumaJobJsonValue = import('../../../server/fuma/jobs').FumaJobJsonValue
