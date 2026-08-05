import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { domainContractAuthorityV2Migration } from '../../../server/fuma/db/migrations/000062_domain_contract_authority_v2'
import { cloudflareHostnameAuthorityV2Migration } from '../../../server/fuma/db/migrations/000064_cloudflare_hostname_authority_v2'
import { FakeCloudflareSaasAdapter } from '../../../server/fuma/cloudflare/adapter'
import { CloudflareSaasReconciler, DomainServiceCloudflareTransitionPort } from '../../../server/fuma/cloudflare/reconciler'
import { PostgresCloudflareStateRepository } from '../../../server/fuma/cloudflare/repository'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { FakeDomainCredentialProvider } from '../../../server/fuma/domains/fakes'
import { NoopDomainCommercialAuthority } from '../../../server/fuma/domains/memory'
import { PostgresDomainRepository } from '../../../server/fuma/domains/postgres'
import { importDomainCredentialKeyring } from '../../../server/fuma/domains/runtime'
import { PostgresRecurringCloudflareSource } from '../../../server/fuma/jobs/runtime/recurringProducers'
import { DomainService } from '../../../server/fuma/domains/service'
import type { DomainScope } from '../../../server/fuma/domains/contracts'
import { subdomainCapability } from './cloudflareSaasTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const scope: DomainScope = Object.freeze({
  platformId: 'fuma', organizationId: 'org-cloudflare-pg', workspaceId: 'workspace-cloudflare-pg',
  siteId: 'site-cloudflare-pg', ownerKey: 'owner-cloudflare-pg', generation: 1,
  state: 'active', transferFence: null, profileId: 'website',
})

function quoted(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema identifier.')
  return `"${value}"`
}
function scopedUrl(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('Cloudflare SaaS native PostgreSQL authority', () => {
  it.skipIf(postgresUrl === undefined)('persists fenced reconciliation and immutable evidence through active cutover', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_cloudflare_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quoted(schema)}`)
    const db = createPostgresClient(scopedUrl(postgresUrl, schema))
    try {
      await db.unsafe(domainContractAuthorityV2Migration.sql)
      await db.unsafe(cloudflareHostnameAuthorityV2Migration.sql)
      await db.unsafe(`
        create table fuma_organization_profiles(organization_id text primary key,status text not null);
        insert into fuma_organization_profiles values('org-cloudflare-pg','active');
        create table fuma_workspaces(organization_id text not null,id text not null,status text not null,primary key(organization_id,id));
        insert into fuma_workspaces values('org-cloudflare-pg','workspace-cloudflare-pg','active');
        create table fuma_sites(organization_id text not null,workspace_id text not null,id text not null,status text not null,profile_id text not null,primary key(organization_id,workspace_id,id));
        insert into fuma_sites values('org-cloudflare-pg','workspace-cloudflare-pg','site-cloudflare-pg','active','website');
        create table fuma_tenant_owner_keys(platform_id text not null,organization_id text not null,workspace_id text not null,site_id text not null,owner_key text not null,generation bigint not null,state text not null,transfer_id text null,transfer_lock_id text null,transfer_fence bigint null,primary key(platform_id,organization_id,workspace_id,site_id,owner_key,generation));
        insert into fuma_tenant_owner_keys values('fuma','org-cloudflare-pg','workspace-cloudflare-pg','site-cloudflare-pg','owner-cloudflare-pg',1,'active',null,null,null);
      `)
      const keys = await importDomainCredentialKeyring({
        activeKeyId: 'domain-key-v1',
        keys: [{ keyId: 'domain-key-v1', bytes: new Uint8Array(32).fill(12) }],
      })
      const domainRepository = new PostgresDomainRepository(db)
      const domains = new DomainService({
        repository: domainRepository,
        cipher: new AesGcmDomainSecretCipher(keys),
        commercial: new NoopDomainCommercialAuthority(),
        provider: new FakeDomainCredentialProvider(),
        now: () => new Date('2026-08-04T12:00:00.000Z'),
      })
      await domains.create(scope, {
        domainId: 'domain-cloudflare-pg', hostname: 'www.customer.example', kind: 'customer-dns',
        credentialId: null, requestedAt: '2026-08-04T12:00:00.000Z',
      })
      const adapter = new FakeCloudflareSaasAdapter()
      const state = new PostgresCloudflareStateRepository(db)
      const reconciler = new CloudflareSaasReconciler(
        adapter,
        new DomainServiceCloudflareTransitionPort(domains),
        state,
        () => new Date('2026-08-04T12:01:00.000Z'),
        'customers.trimly.co.ke',
      )
      let domain = await domainRepository.exact(scope, 'domain-cloudflare-pg')
      if (!domain) throw new Error('Domain fixture unavailable.')
      const prevalidated = await reconciler.prevalidate(scope, domain, subdomainCapability)
      expect(prevalidated.records).toContainEqual(expect.objectContaining({ type: 'CNAME', value: 'customers.trimly.co.ke' }))
      adapter.activate(prevalidated.binding.providerHostnameId)
      domain = await domainRepository.exact(scope, domain.domainId)
      if (!domain) throw new Error('Validating domain unavailable.')
      const reconciled = await Promise.allSettled([
        reconciler.reconcile(scope, domain),
        reconciler.reconcile(scope, domain),
      ])
      expect(reconciled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(reconciled.filter(({ status }) => status === 'rejected')).toHaveLength(1)
      expect((await state.exact(scope, domain.domainId))?.version).toBe(2)
      domain = await domainRepository.exact(scope, domain.domainId)
      if (!domain) throw new Error('Ready domain unavailable.')
      const active = await reconciler.cutover(scope, domain)
      expect(active).toMatchObject({ lifecycle: 'active', ownershipVerified: true, sslStatus: 'active' })
      expect(await new PostgresRecurringCloudflareSource(db).listPollableBindings(100)).toEqual([{
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        domainId: domain.domainId,
      }])
      expect(await state.exact({ ...scope, organizationId: 'org-foreign' }, domain.domainId)).toBeNull()

      const counts = await db.unsafe<{ bindings: number; operations: number; transitions: number }>(`
        select
          (select count(*)::int from fuma_cloudflare_hostname_authority_v2) bindings,
          (select count(*)::int from fuma_cloudflare_hostname_operations_v2) operations,
          (select count(*)::int from fuma_domain_transitions_v2) transitions
      `)
      expect(counts.rows[0]).toEqual({ bindings: 1, operations: 3, transitions: 3 })
      await expect(db.unsafe("update fuma_cloudflare_hostname_operations_v2 set operation_sha256=repeat('0',64)"))
        .rejects.toThrow('Cloudflare reconciliation evidence is immutable')
    } finally {
      await admin.unsafe(`drop schema if exists ${quoted(schema)} cascade`)
    }
  }, 30_000)
})
