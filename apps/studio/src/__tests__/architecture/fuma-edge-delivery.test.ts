import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('FUMA-051 edge-delivery architecture', () => {
  test('uses strict TypeBox request authority and host/site/release/access-separated keys', () => {
    const service = read('server/fuma/edgeDelivery/service.ts')
    expect(service).toContain('EdgeRequestContextSchema = Type.Object')
    expect(service).toContain('{ additionalProperties: false }')
    expect(service).toContain('edge:${host}:${siteId}:')
    expect(service).toContain('${context.releaseId}:')
    expect(service).toContain('context.memberId')
    expect(service).toContain('context.accessFingerprint')
    expect(service).not.toContain('zod')
  })

  test('keeps request holes no-store, member holes private, and immutable assets public', () => {
    const service = read('server/fuma/edgeDelivery/service.ts')
    expect(service).toContain("'private, no-store'")
    expect(service).toContain("'private, max-age=30, stale-while-revalidate=90'")
    expect(service).toContain("'public, max-age=31536000, immutable'")
    expect(service).toContain("'Cookie, Authorization'")
    expect(service).toContain('member-required')
  })

  test('uses a bounded atomic Redis prefix purge and fail-open cache reads/writes', () => {
    const cache = read('server/fuma/edgeDelivery/redisCache.ts')
    expect(cache).toContain("redis.call('SCAN'")
    expect(cache).toContain("redis.call('UNLINK'")
    expect(cache).toContain('edge purge exceeds bounded key count')
    expect(cache).toContain('catch { return null }')
    expect(cache).toContain('cache is fail-open')
  })

  test('rechecks exact active release and performs compare-and-set rollback with retention roots', () => {
    const postgres = read('server/fuma/edgeDelivery/postgres.ts')
    expect(postgres).toContain('pointer.releaseId !== context.releaseId')
    expect(postgres).toContain("current.status !== 'active'")
    expect(postgres).toContain("target.status !== 'ready'")
    expect(postgres).toContain('putActivePointer(nextPointer, pointer.version)')
    expect(postgres).toContain("deleteRetentionRoot('active', 'active')")
    expect(postgres).toContain('sha256Hex(bytes) !== resolved.contentHashSha256')
  })

  test('registers all three trusted site jobs without tenant or host fields in payload schemas', () => {
    const jobs = read('server/fuma/edgeDelivery/jobHandlers.ts')
    for (const kind of ['fuma.edge-purge', 'fuma.edge-warm', 'fuma.edge-rollback']) expect(jobs).toContain(kind)
    expect(jobs).toContain("context.jobContext.kind !== 'site'")
    const schemas = jobs.slice(jobs.indexOf('const EdgePurgePayloadSchema'), jobs.indexOf('export const EDGE_PURGE_JOB_KIND'))
    for (const field of ['platformId', 'organizationId', 'workspaceId', 'siteId', 'ownerKey', 'host']) expect(schemas).not.toContain(field)
    expect(jobs).toContain('readDurableResult')
    expect(jobs).toContain('commitDurableResult')
  })

  test('provides a complete production graph while leaving central mounting to the conductor', () => {
    const runtime = read('server/fuma/edgeDelivery/runtime.ts')
    const freeHostRuntime = read('server/fuma/freeHosts/runtime.ts')
    expect(runtime).toContain('PostgresEdgeReleaseReader')
    expect(runtime).toContain('PostgresEdgePointerAuthority')
    expect(runtime).toContain('BunRedisEdgeCache')
    expect(runtime).toContain('edgeDeliveryJobRegistration')
    expect(freeHostRuntime).not.toContain('createHostedEdgeRuntime')
  })
})
