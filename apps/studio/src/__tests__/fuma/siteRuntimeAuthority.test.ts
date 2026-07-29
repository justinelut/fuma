import { describe, expect, test } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { createReleaseManifest } from '../../../server/fuma/releases'
import { sha256Hex, type TenantObjectStorage } from '../../../server/fuma/objectStorage'
import { RuntimeTreeRendererAdapter, type WorkerRenderedArtifact } from '../../../server/fuma/publishing/runtimeTree/renderer'
import { createSiteRuntimePrivateBoundary } from '../../../server/fuma/siteRuntime/boundary'
import { PostgresSiteRuntimeAuthority } from '../../../server/fuma/siteRuntime/service'
import {
  MemorySiteRuntimeMutationReceiptRepository,
  MemorySiteRuntimeRolloutRepository,
  SiteRuntimeApplicationAuthority,
  emptyApplicationSnapshot,
  publicApplicationMember,
  publicAudience,
} from '../../../server/fuma/siteRuntime'
import {
  SITE_002_AUTHORITY,
  SeededLegacySemanticRenderer,
  seededProjection,
  seededRuntimeRelease,
} from '../../../../../tooling/site-runtime/runtimeReleaseFixtures'

class MemoryCache {
  readonly values = new Map<string, string>()
  async cacheGet(key: string) { return this.values.get(key) ?? null }
  async cacheSet(key: string, value: string) { this.values.set(key, value); return true }
}

async function releaseFixture(revision: 1 | 2) {
  const seed = seededRuntimeRelease(revision)
  const adapter = new RuntimeTreeRendererAdapter({ semanticRenderer: new SeededLegacySemanticRenderer(), project: seededProjection })
  const rendered: WorkerRenderedArtifact[] = []
  for await (const artifact of adapter.render(SITE_002_AUTHORITY, seed.sourceSnapshot)) rendered.push(artifact)
  const manifest = createReleaseManifest({
    releaseId: seed.releaseId,
    ownerKey: SITE_002_AUTHORITY.scope.ownerKey,
    siteId: SITE_002_AUTHORITY.scope.siteId,
    sourceSnapshotHashSha256: seed.sourceSnapshot.hashSha256,
    artifacts: rendered.map(({ logicalPath, kind, bytes, mimeType, references }) => ({ logicalPath, kind, contentHashSha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, mimeType, references })),
    createdAt: `2026-07-29T0${revision}:00:00.000Z`,
  })
  const objects = new Map<string, Uint8Array>()
  for (const artifact of manifest.artifacts) objects.set(artifact.objectKey, rendered.find(({ logicalPath }) => logicalPath === artifact.logicalPath)!.bytes)
  return { seed, manifest, objects }
}

function row(fixture: Awaited<ReturnType<typeof releaseFixture>>, host = 'alpha.fuma.co.ke') {
  return {
    host,
    platform_id: SITE_002_AUTHORITY.scope.platformId,
    organization_id: SITE_002_AUTHORITY.scope.organizationId,
    workspace_id: SITE_002_AUTHORITY.scope.workspaceId,
    site_id: SITE_002_AUTHORITY.scope.siteId,
    owner_key: SITE_002_AUTHORITY.scope.ownerKey,
    owner_generation: SITE_002_AUTHORITY.scope.generation,
    release_id: fixture.seed.releaseId,
    manifest_json: fixture.manifest,
  }
}

function database(read: (host: string, call: number) => unknown | null): DbClient {
  let calls = 0
  const query = (async <Row>(_strings: TemplateStringsArray, ...values: unknown[]): Promise<DbResult<Row>> => {
    calls += 1
    const result = read(String(values[0]), calls)
    return { rows: result ? [result as Row] : [], rowCount: result ? 1 : 0 }
  }) as DbClient
  query.transaction = async <T>(work: (transaction: DbClient) => Promise<T>) => await work(query)
  return Object.assign(query, { dialect: 'postgres' as const })
}

function storage(objects: Map<string, Uint8Array>, reads: { count: number }): TenantObjectStorage {
  return {
    async get(_scope, key) { reads.count += 1; const value = objects.get(key); if (!value) throw new Error('missing'); return value.slice() },
    async put() { throw new Error('unused') }, async beginMultipart() { throw new Error('unused') },
    async head() { throw new Error('unused') }, async list() { throw new Error('unused') },
    async delete() { throw new Error('unused') }, async createSignedUrl() { throw new Error('unused') }, async redeemSignedUrl() { throw new Error('unused') },
  }
}

function service(input: { db: DbClient; storage: TenantObjectStorage; cache: MemoryCache; member?: boolean }) {
  const application = new SiteRuntimeApplicationAuthority({
    rollouts: new MemorySiteRuntimeRolloutRepository(),
    receipts: new MemorySiteRuntimeMutationReceiptRepository(),
    legacy: { async read() { throw new Error('unused') } },
    ...(input.member ? {
      members: {
        async resolve({ memberSessionToken }: { memberSessionToken: string | null }) {
          return memberSessionToken
            ? {
                audience: { kind: 'member' as const, memberId: 'member-a', accessFingerprintSha256: 'f'.repeat(64) },
                member: { authenticated: true as const, memberIdentityId: 'identity-a', memberId: 'member-a', sessionId: 'session-a', displayName: 'Member A' },
                snapshot: emptyApplicationSnapshot(),
              }
            : { audience: publicAudience(), member: publicApplicationMember(), snapshot: emptyApplicationSnapshot() }
        },
      },
    } : {}),
  })
  return new PostgresSiteRuntimeAuthority({
    db: input.db,
    storage: input.storage,
    coordination: input.cache,
    application,
    supportedDeployments: ['1.0.0', '0.9.0'],
  })
}

const request = { host: 'ALPHA.fuma.co.ke:443', route: '/menu', canonicalQuery: '', runtimeDeploymentVersion: '1.0.0', memberSessionToken: null }

describe('FUMA-SITE-003 private runtime authority', () => {
  test('resolves one exact active host and immutable route with public/member cache separation', async () => {
    const fixture = await releaseFixture(1)
    const reads = { count: 0 }
    const cache = new MemoryCache()
    const runtime = service({ db: database((host) => host === 'alpha.fuma.co.ke' ? row(fixture) : null), storage: storage(fixture.objects, reads), cache, member: true })
    const publicResult = await runtime.resolve(request)
    const memberResult = await runtime.resolve({ ...request, memberSessionToken: 's'.repeat(48) })
    expect(publicResult.cacheIdentity).toMatchObject({ host: 'alpha.fuma.co.ke', releaseId: fixture.seed.releaseId, route: '/menu', audience: { kind: 'public' } })
    expect(memberResult.cacheIdentity.audience).toEqual({ kind: 'member', memberId: 'member-a', accessFingerprintSha256: 'f'.repeat(64) })
    expect(publicResult.routeArtifact.page.title).toBe('Seasonal menu')
    expect(cache.values.size).toBe(1)
    expect(() => JSON.stringify(publicResult)).not.toThrow()
  })

  test('coordinates immutable route cache across runtime instances without path-only reuse', async () => {
    const fixture = await releaseFixture(1)
    const reads = { count: 0 }
    const cache = new MemoryCache()
    const db = database((host) => host === 'alpha.fuma.co.ke' ? row(fixture) : null)
    const objects = storage(fixture.objects, reads)
    await service({ db, storage: objects, cache }).resolve(request)
    const afterFirst = reads.count
    await service({ db, storage: objects, cache }).resolve(request)
    expect(reads.count).toBe(afterFirst + 1) // snapshot re-establishes active release; route bytes came from shared cache
    expect(cache.values.size).toBe(1)
  })

  test('fails closed for unknown host, deployment drift, and activation during object reads', async () => {
    const first = await releaseFixture(1)
    const second = await releaseFixture(2)
    const reads = { count: 0 }
    const runtime = service({
      db: database((_host, call) => call === 1 ? row(first) : row(second)),
      storage: storage(first.objects, reads),
      cache: new MemoryCache(),
    })
    await expect(runtime.resolve(request)).rejects.toThrow('changed')
    await expect(service({ db: database(() => null), storage: storage(first.objects, reads), cache: new MemoryCache() }).resolve(request)).rejects.toThrow('unavailable')
    await expect(service({ db: database(() => row(first)), storage: storage(first.objects, reads), cache: new MemoryCache() }).resolve({ ...request, runtimeDeploymentVersion: '2.0.0' })).rejects.toThrow('not accepted')
  })

  test('requires exact private host, bearer audience, UUID request identity, and no cookies', async () => {
    const fixture = await releaseFixture(1)
    const runtime = service({ db: database(() => row(fixture)), storage: storage(fixture.objects, { count: 0 }), cache: new MemoryCache() })
    const boundary = createSiteRuntimePrivateBoundary({ host: 'runtime.internal:3001', serviceToken: 't'.repeat(40), authority: runtime })
    const make = (values: Record<string, string>) => {
      const requestHeaders = new Headers({ host: 'runtime.internal:3001', 'content-type': 'application/json' })
      for (const [name, value] of Object.entries(values)) requestHeaders.set(name, value)
      return new Request('http://runtime.internal:3001/_fuma/private/site-runtime/v1/resolve', { method: 'POST', headers: requestHeaders, body: JSON.stringify(request) })
    }
    expect((await boundary.handle(make({})))?.status).toBe(404)
    const forwardedRequest = make({ authorization: `Bearer ${'t'.repeat(40)}`, 'x-fuma-audience': 'fuma-site-runtime', 'x-fuma-request-id': crypto.randomUUID(), 'x-forwarded-authorization': 'Bearer staff' })
    expect((await boundary.handle(forwardedRequest))?.status).toBe(404)
    const response = await boundary.handle(make({ authorization: `Bearer ${'t'.repeat(40)}`, 'x-fuma-audience': 'fuma-site-runtime', 'x-fuma-request-id': crypto.randomUUID() }))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('cache-control')).toBe('private, no-store')
  })
})
