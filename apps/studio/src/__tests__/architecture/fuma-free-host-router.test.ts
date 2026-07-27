import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('FUMA-050 free-host architecture', () => {
  it('keeps host/edge authority in dedicated strict TypeBox modules with no Zod', () => {
    const service = read('server/fuma/freeHosts/service.ts')
    const repository = read('server/fuma/freeHosts/repository.ts')
    const router = read('server/fuma/freeHosts/publicRouter.ts')
    const all = `${service}\n${repository}\n${router}`
    expect(all).not.toMatch(/from ['"]zod|\bz\.(?:object|string|union)\b/)
    expect(service).toContain('additionalProperties: false')
    expect(repository).toContain("db.dialect !== 'postgres'")
    expect(repository).toContain("and owner.transfer_fence is null")
    expect(repository).toContain("and release.status = 'active'")
    expect(repository).toContain('and release.release_id = pointer.release_id')
    expect(router).toContain('artifact.objectKey')
    expect(router).toContain('x-fuma-release-id')
  })

  it('centrally composes hosted Host routing before legacy self-host public fallback', () => {
    const server = read('server/index.ts')
    const router = read('server/router.ts')
    expect(server).toContain('createHostedFreeHostRuntime')
    expect(server).toContain('freeHostPublic: freeHostRuntime?.boundary')
    expect(router).toContain('freeHostPublic?: FreeHostPublicBoundary')
    expect(server.indexOf('freeHostRuntime.boundary.route(req)')).toBeLessThan(server.indexOf('publicationSockets?.handles(req)'))
    expect(server.indexOf('freeHostRuntime.boundary.route(req)')).toBeLessThan(server.indexOf("req.method === 'OPTIONS'"))
    expect(router.indexOf('runtime.freeHostPublic.route(req)')).toBeLessThan(router.indexOf('for (const route of routes)'))
    expect(router.lastIndexOf('async function tryServePublicRoute')).toBeGreaterThan(router.indexOf('runtime.freeHostPublic.route(req)'))
  })

  it('reserves additive migration ID 000043 without editing finalized 000022', () => {
    const original = read('server/fuma/db/migrations/000022_free_hosts.ts')
    const followup = read('server/fuma/db/migrations/000043_free_host_authority.ts')
    expect(original).toContain("id:'000022_free_hosts'")
    expect(followup).toContain("id: '000043_free_host_authority'")
    expect(followup).not.toMatch(/\bdrop\s+(?:table|column|schema|constraint)\b/i)
  })
})
