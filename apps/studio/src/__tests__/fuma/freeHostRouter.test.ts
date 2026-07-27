import { describe, expect, it } from 'bun:test'
import {
  FakeObjectStorageTransport,
  FumaObjectStorage,
  sha256Hex,
  type TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import { createReleaseManifest, type ReleaseManifest } from '../../../server/fuma/releases'
import {
  FreeHostError,
  FreeHostPublicRouter,
  FreeHostService,
  MemoryFreeHostRepository,
  RESERVED_FREE_HOST_LABELS,
  normalizeFreeHostLabel,
  normalizePublicHost,
  type ActiveReleaseResolver,
  type FreeHostAuthority,
} from '../../../server/fuma/freeHosts'

const NOW = '2026-07-26T12:00:00.000Z'
const SOURCE_HASH = 'a'.repeat(64)
const encoder = new TextEncoder()

function authority(id: string, generation = 1): FreeHostAuthority {
  return Object.freeze({
    platformId: 'platform-fuma',
    organizationId: `organization-${id}`,
    workspaceId: `workspace-${id}`,
    siteId: `site-${id}`,
    ownerKey: `owner-${id}`,
    ownerGeneration: generation,
  })
}

function release(
  scope: FreeHostAuthority,
  releaseId: string,
  html: string,
): { manifest: ReleaseManifest; bytes: Uint8Array } {
  const bytes = encoder.encode(html)
  return {
    bytes,
    manifest: createReleaseManifest({
      releaseId,
      ownerKey: scope.ownerKey,
      siteId: scope.siteId,
      sourceSnapshotHashSha256: SOURCE_HASH,
      createdAt: NOW,
      artifacts: [{
        logicalPath: '/index.html',
        kind: 'html',
        contentHashSha256: sha256Hex(bytes),
        sizeBytes: bytes.byteLength,
        mimeType: 'text/html',
        references: [],
      }],
    }),
  }
}

function storage(): TenantObjectStorage {
  return new FumaObjectStorage({
    transport: new FakeObjectStorageTransport(() => Date.parse(NOW)),
    policy: {
      allowedMimeTypes: ['text/html', 'text/css'],
      maxObjectBytes: 1_000_000,
      maxTenantBytes: 10_000_000,
    },
    signingSecret: 'fuma-free-host-fixture-signing-secret',
    accessUrlBase: 'https://app.fuma.co.ke/_fuma/objects',
    nowMs: () => Date.parse(NOW),
  })
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

function hostRequest(host: string, path = '/'): Request {
  return {
    method: 'GET',
    url: `http://internal${path}`,
    headers: { get: (name: string) => name.toLowerCase() === 'host' ? host : null },
  } as unknown as Request
}

describe('FUMA-050 free-host normalization and authority properties', () => {
  it('normalizes a deterministic case/port/dot corpus and rejects IDN, extra dots, and bad ports', () => {
    const random = seededRandom(0xf050)
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
    for (let index = 0; index < 256; index += 1) {
      let label = 't'
      for (let offset = 0; offset < 10; offset += 1) {
        const character = alphabet[Math.floor(random() * alphabet.length)]!
        label += random() > 0.5 ? character.toUpperCase() : character
      }
      label += 'z'
      const expected = label.toLowerCase()
      expect(normalizeFreeHostLabel(label)).toBe(expected)
      expect(normalizePublicHost(`${label}.FuMa.Co.Ke:443.`)).toBe(`${expected}.fuma.co.ke`)
      expect(normalizePublicHost(`${label}.FuMa.Co.Ke.:8443`)).toBe(`${expected}.fuma.co.ke`)
    }
    for (const value of [
      'ténant.fuma.co.ke', 'xn--tnant-bsa.fuma.co.ke', '.tenant.fuma.co.ke',
      'tenant..fuma.co.ke', 'tenant.fuma.co.ke..', 'tenant.fuma.co.ke.:443.',
      'tenant.fuma.co.ke:0', 'tenant.fuma.co.ke:65536',
      'tenant.fuma.co.ke/path', 'tenant.fuma.co.ke,evil.example',
    ]) expect(() => normalizePublicHost(value)).toThrow(FreeHostError)
  })

  it('permanently rejects the required and reviewed operational labels', () => {
    for (const label of RESERVED_FREE_HOST_LABELS) {
      expect(() => normalizeFreeHostLabel(label.toUpperCase())).toThrow(FreeHostError)
    }
    for (const label of ['fuma', 'fuma-internal', 'xn--tenant']) {
      expect(() => normalizeFreeHostLabel(label)).toThrow(FreeHostError)
    }
  })

  it('serializes host/site collisions and fences state changes by generation and version', async () => {
    const repository = new MemoryFreeHostRepository()
    const releases: ActiveReleaseResolver = { async exactSite() { return { releaseId: 'release-a' } } }
    const service = new FreeHostService(repository, releases, () => new Date(NOW))
    const scope = authority('a', 7)
    const allocated = await service.allocate({ ...scope, label: 'tenant-a' })
    await expect(service.allocate({ ...authority('b'), label: 'TENANT-A' }))
      .rejects.toMatchObject({ code: 'collision' })
    await expect(service.allocate({ ...scope, label: 'tenant-b' }))
      .rejects.toMatchObject({ code: 'collision' })
    await expect(service.setState({
      host: allocated.host,
      state: 'suspended',
      authority: { ...scope, ownerGeneration: 8 },
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'stale-authority' })
    const suspended = await service.setState({
      host: allocated.host,
      state: 'suspended',
      authority: scope,
      expectedVersion: 1,
    })
    expect(suspended).toMatchObject({ state: 'suspended', version: 2 })
    await expect(service.setState({
      host: allocated.host,
      state: 'active',
      authority: scope,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'stale-authority' })
    await expect(service.resolve(allocated.host)).rejects.toMatchObject({ code: 'suspended' })
  })

  it('never substitutes tenant or release authority', async () => {
    const repository = new MemoryFreeHostRepository()
    const scopes = new Map<string, { authority: FreeHostAuthority; releaseId: string }>()
    const resolver: ActiveReleaseResolver = {
      async exactSite(scope) {
        const expected = scopes.get(scope.host)
        if (!expected || JSON.stringify(scope).includes(expected.authority.siteId) === false) return null
        if (scope.ownerKey !== expected.authority.ownerKey
          || scope.ownerGeneration !== expected.authority.ownerGeneration) return null
        return { releaseId: expected.releaseId }
      },
    }
    const service = new FreeHostService(repository, resolver, () => new Date(NOW))
    for (const id of ['a', 'b']) {
      const scope = authority(id)
      const record = await service.allocate({ ...scope, label: `tenant-${id}` })
      scopes.set(record.host, { authority: scope, releaseId: `release-${id}` })
    }
    await expect(service.resolve('tenant-a.fuma.co.ke')).resolves.toMatchObject({ releaseId: 'release-a' })
    await expect(service.resolve('tenant-b.fuma.co.ke')).resolves.toMatchObject({ releaseId: 'release-b' })
    await expect(service.resolve('unknown.fuma.co.ke')).rejects.toMatchObject({ code: 'unknown' })
    await expect(service.resolve('fuma.co.ke')).rejects.toThrow('No default host is configured.')
  })
})

describe('FUMA-050 public Host router', () => {
  it('deterministically serves two active releases by exact Host header with no fallback', async () => {
    const repository = new MemoryFreeHostRepository()
    const objectStorage = storage()
    const active = new Map<string, { releaseId: string; manifest: ReleaseManifest }>()
    const resolver: ActiveReleaseResolver = {
      async exactSite(scope) { return active.get(scope.host) ?? null },
    }
    const service = new FreeHostService(repository, resolver, () => new Date(NOW))
    for (const id of ['alpha', 'bravo']) {
      const scope = authority(id)
      const record = await service.allocate({ ...scope, label: `tenant-${id}` })
      const fixture = release(scope, `release-${id}`, `<!doctype html><h1>${id}</h1>`)
      active.set(record.host, { releaseId: `release-${id}`, manifest: fixture.manifest })
      await objectStorage.put({
        scope: {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
        },
        key: fixture.manifest.artifacts[0]!.objectKey,
        bytes: fixture.bytes,
        mimeType: 'text/html',
        checksumSha256: fixture.manifest.artifacts[0]!.contentHashSha256,
      })
    }
    const router = new FreeHostPublicRouter({
      service,
      storage: objectStorage,
      controlHosts: ['app.fuma.co.ke'],
      extensions: [{
        handles(request) { return new URL(request.url).pathname === '/dynamic' },
        async handle() { return new Response('dynamic publication', { headers: { 'cache-control': 'no-store' } }) },
      }],
    })
    for (const id of ['alpha', 'bravo']) {
      const response = await router.route(hostRequest(`tenant-${id}.fuma.co.ke`))
      expect(response?.status).toBe(200)
      expect(response?.headers.get('x-fuma-release-id')).toBe(`release-${id}`)
      expect(await response?.text()).toBe(`<!doctype html><h1>${id}</h1>`)
    }
    const dynamic = await router.route(hostRequest('tenant-alpha.fuma.co.ke', '/dynamic'))

    expect(dynamic?.status).toBe(200)
    expect(await dynamic?.text()).toBe('dynamic publication')
    expect((await router.route(hostRequest('unknown.fuma.co.ke', '/dynamic')))?.status).toBe(404)
    const canonical = await router.route(hostRequest('TENANT-ALPHA.FUMA.CO.KE:443.', '/about?x=1'))
    expect(canonical?.status).toBe(308)
    expect(canonical?.headers.get('location')).toBe('https://tenant-alpha.fuma.co.ke/about?x=1')
    const unknown = await router.route(hostRequest('unknown.fuma.co.ke'))
    expect(unknown?.status).toBe(404)
    expect(unknown?.headers.get('x-fuma-release-id')).toBeNull()
    expect((await router.route(hostRequest('tenant..fuma.co.ke')))?.status).toBe(421)
    expect((await router.route(hostRequest('admin.fuma.co.ke')))?.status).toBe(404)
    expect(await router.route(hostRequest('app.fuma.co.ke', '/admin'))).toBeNull()
    await service.setState({
      host: 'tenant-bravo.fuma.co.ke',
      state: 'suspended',
      authority: authority('bravo'),
      expectedVersion: 1,
    })
    const suspended = await router.route(hostRequest('tenant-bravo.fuma.co.ke'))
    expect(suspended?.status).toBe(404)
    expect(suspended?.headers.get('x-fuma-release-id')).toBeNull()
    process.stdout.write('[FUMA-050 Host demo] tenant-alpha=release-alpha tenant-bravo=release-bravo unknown=404 fallback=none\n')
  })

  it('dispatches an exact resolved release through the edge boundary before direct object reads', async () => {
    const repository = new MemoryFreeHostRepository()
    const objectStorage = storage()
    const scope = authority('edge')
    const service = new FreeHostService(repository, { async exactSite() { return { releaseId: 'release-edge' } } }, () => new Date(NOW))
    await service.allocate({ ...scope, label: 'tenant-edge' })
    const seen: string[] = []
    const router = new FreeHostPublicRouter({
      service,
      storage: objectStorage,
      controlHosts: [],
      edge: {
        async serve(_request, resolution) {
          seen.push(`${resolution.host.host}:${resolution.releaseId}`)
          return new Response('edge-owned', { headers: { 'x-fuma-release-id': resolution.releaseId } })
        },
      },
    })
    const response = await router.route(hostRequest('tenant-edge.fuma.co.ke'))
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe('edge-owned')
    expect(seen).toEqual(['tenant-edge.fuma.co.ke:release-edge'])
    expect((await router.route(hostRequest('unknown.fuma.co.ke')))?.status).toBe(404)
    expect(seen).toHaveLength(1)
  })

  it('canonicalizes authority and configured custom host while preserving path and query', async () => {
    const repository = new MemoryFreeHostRepository()
    const objectStorage = storage()
    const scope = authority('canonical')
    const service = new FreeHostService(repository, { async exactSite() { return { releaseId: 'unused' } } }, () => new Date(NOW))
    await service.allocate({ ...scope, label: 'tenant-canonical', canonicalHost: 'www.example.co.ke' })
    const router = new FreeHostPublicRouter({ service, storage: objectStorage, controlHosts: [] })
    const canonical = await router.route(hostRequest('TENANT-CANONICAL.FUMA.CO.KE:443.', '/about?ref=demo'))
    expect(canonical?.status).toBe(308)
    expect(canonical?.headers.get('location')).toBe('https://www.example.co.ke/about?ref=demo')
  })
})
