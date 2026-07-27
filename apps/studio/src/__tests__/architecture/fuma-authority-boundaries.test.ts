import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function expectOrdered(source: string, labels: readonly string[]): void {
  let previous = -1
  for (const label of labels) {
    const current = source.indexOf(label)
    expect(current, `missing authority boundary marker: ${label}`).toBeGreaterThan(-1)
    expect(current, `authority boundary marker is out of order: ${label}`).toBeGreaterThan(previous)
    previous = current
  }
}

function methodBody(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  return from >= 0 && to > from ? source.slice(from, to) : ''
}

describe('FUMA protected authority boundaries', () => {
  it('checks mutation Origin and caller authority substitutions before trusted HTTP derivation', () => {
    const source = read('server/fuma/context/middleware.ts')
    const authorize = methodBody(
      source,
      'async function authorize(',
      '\n  async function handle(request: Request)',
    )
    const handle = methodBody(
      source,
      'async function handle(request: Request)',
      '\n  return Object.freeze({ handles, authorize, handle })',
    )

    expectOrdered(authorize, [
      'input.allowsMutationOrigin(request)',
      'callerClaimsHeaderAuthority(request)',
      'deriveFumaRequestContext({',
      'deriveFumaRepositoryScope({',
      "repositoryScope.state !== 'active'",
      'repositoryScope.transferFence !== null',
    ])
    expectOrdered(handle, [
      'input.allowsMutationOrigin(request)',
      'callerClaimsHeaderAuthority(request)',
      'callerClaimsBodyAuthority(request)',
      'deriveFumaRequestContext({',
      'selected.route.handler(handlerInput)',
    ])
    expect(source).toContain("selected.route.method !== 'GET'")
    expect(source).toContain("jsonError('Origin not allowed.', 403)")
    expect(source).toContain('readValidatedBody(request.clone(), Type.Unknown())')
    for (const reservedClaim of [
      'protectedownerinvariant',
      'roleassignments',
      'requiredpermission',
      'correlationid',
      'requestid',
    ]) {
      expect(source).toContain(`'${reservedClaim}'`)
    }
  })

  it('keeps durable payload outside job authority lookup and derivation', () => {
    const source = read('server/fuma/context/jobContext.ts')

    expect(source).not.toMatch(/\b(?:job|jobRecord|input\.jobRecord)\.payload\b/)
    expect(source).toContain('loadTrustedJobAuthority(input: FumaJobAuthorityLookupInput)')
    expectOrdered(source, [
      'const job = readRunningJob(input.jobRecord',
      'input.authority.loadTrustedJobAuthority({',
      'const authority = readAuthority(rawAuthority)',
    ])
    expect(source).toContain('claimExpiresAt <= trustedNow(now)')
    expect(source).toContain('job.attemptCount > job.maxAttempts')
    expect(source).toContain('job.fence !== fence.toString()')
    expect(source).toContain('organizationId: job.organizationId')
    expect(source).toContain('siteId: job.siteId')
    expect(source).toContain('jobKind: job.kind')
  })

  it('locks exact platform ancestry and protected internal-console non-synthesis', () => {
    const resolver = read('server/fuma/permissions/resolver.ts')
    const catalog = read('src/core/fuma/permissionCatalog.ts')

    for (const record of ['organization', 'workspace', 'site']) {
      expect(resolver).toContain(`${record}.platformId !== scope.platformId`)
    }
    expectOrdered(resolver, [
      "precedence: 'capability-unavailable'",
      "precedence: 'protected-owner-invariant'",
      "precedence: 'explicit-deny'",
      "catalogEntry?.authority !== 'customer' && !invariant",
      "precedence: 'explicit-grant'",
    ])
    for (const namespace of ['admin', 'console', 'internal', 'platform', 'support']) {
      expect(catalog).toContain(`'${namespace}'`)
    }
  })

  it('publishes canonical barrels for external permission and context consumers', () => {
    expect(read('src/core/fuma/index.ts')).toContain("export * from './permissionCatalog'")
    expect(read('src/core/fuma/index.ts')).toContain("export * from './permissionContracts'")
    expect(read('server/fuma/permissions/index.ts')).toContain("export * from './resolver'")
    expect(read('server/fuma/context/index.ts')).toContain("export * from './requestContext'")
    expect(read('server/fuma/context/index.ts')).toContain("export * from './jobContext'")
    expect(read('server/fuma/context/index.ts')).toContain("export * from './middleware'")
  })
})
