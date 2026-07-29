import { describe, expect, it } from 'bun:test'
import { cloudflareHostnameAuthorityV2Migration } from '../../../server/fuma/db/migrations/000064_cloudflare_hostname_authority_v2'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations } from '../../../server/fuma/db/migrations'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { createCloudflareRouteDeclarations } from '../../../server/fuma/cloudflare/routes'
import { cloudflareJobRegistration, CLOUDFLARE_RECONCILE_JOB_KIND } from '../../../server/fuma/cloudflare/jobHandlers'
import { createCloudflareFixture } from './cloudflareSaasTestFixture'

const moduleNames = ['adapter.ts', 'contracts.ts', 'jobHandlers.ts', 'metering.ts', 'reconciler.ts', 'repository.ts', 'routes.ts'] as const

async function source(path: string) {
  return await Bun.file(new URL(path, import.meta.url)).text()
}

describe('FUMA-060 Cloudflare SaaS architecture', () => {
  it('keeps provider transport injected and ticket modules free of live network and environment access', async () => {
    const sources = await Promise.all(moduleNames.map((name) => source(`../../../server/fuma/cloudflare/${name}`)))
    for (const value of sources) {
      expect(value).not.toMatch(/\b(?:Bun\.)?fetch\s*\(/)
      expect(value).not.toMatch(/process\.env|Bun\.env/)
      expect(value).not.toMatch(/from ['"](?:\.\.\/){3,}(?:router|index)['"]/)
    }
    expect(sources.join('\n')).toContain('CloudflareHttpClient')
  })

  it('publishes only unmounted scoped route and job declarations with server-derived authority', () => {
    const fixture = createCloudflareFixture()
    const routes = createCloudflareRouteDeclarations({ reconciler: fixture.reconciler, domains: { async exact() { return null } } })
    expect(routes.map(({ method, path, permission }) => [method, path, permission])).toEqual([
      ['GET', '/settings/domains/:domainId/cloudflare', 'site.settings.read'],
      ['POST', '/settings/domains/:domainId/cloudflare/prevalidate', 'site.settings.write'],
      ['POST', '/settings/domains/:domainId/cloudflare/reconcile', 'site.settings.write'],
      ['POST', '/settings/domains/:domainId/cloudflare/cutover', 'site.settings.write'],
      ['POST', '/settings/domains/:domainId/cloudflare/rollback', 'site.settings.write'],
      ['POST', '/settings/domains/:domainId/cloudflare/diagnose', 'site.settings.write'],
      ['DELETE', '/settings/domains/:domainId/cloudflare', 'site.settings.write'],
    ])
    expect(Object.keys(cloudflareJobRegistration({ reconciler: fixture.reconciler, domains: { async exact() { return null } } }))).toEqual([CLOUDFLARE_RECONCILE_JOB_KIND])
  })

  it('registers the additive authority migration with its finalized checksum', () => {
    expect(() => assertHostedMigrationIsAdditive(cloudflareHostnameAuthorityV2Migration)).not.toThrow()
    expect(cloudflareHostnameAuthorityV2Migration.sql).toMatch(/unique \(platform_id, hostname\)/)
    expect(cloudflareHostnameAuthorityV2Migration.sql).toMatch(/lifecycle <> 'active'.*ssl_status = 'active'/s)
    expect(cloudflareHostnameAuthorityV2Migration.sql).toMatch(/Cloudflare reconciliation evidence is immutable/)
    expect(cloudflareHostnameAuthorityV2Migration.sql).not.toMatch(/\bdrop\s+(?:table|column|schema)\b/i)
    expect(hostedMigrations).toContain(cloudflareHostnameAuthorityV2Migration)
    expect(hostedMigrationChecksum(cloudflareHostnameAuthorityV2Migration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[cloudflareHostnameAuthorityV2Migration.id])
  })

  it('documents customer DNS ownership, lifecycle recovery, metering baseline, apex gates, and conductor work', async () => {
    const documentation = await source('../../../../../docs/reference/fuma-cloudflare-saas-hostnames.md')
    for (const marker of [
      'authoritative DNS', 'customerAccountRequired: false', 'prevalidation', 'rollback', '50,000',
      'US$0.10', '2026-07-23', 'actual quote', 'security/cost review', 'margin gate', 'Conductor integration',
    ]) expect(documentation).toContain(marker)
  })
})
