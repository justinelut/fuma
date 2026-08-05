import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { staffIdentityMigration } from '../../../server/fuma/db/migrations/000003_staff_identity'
import { organizationsMigration } from '../../../server/fuma/db/migrations/000004_organizations'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { tenantKeysMigration } from '../../../server/fuma/db/migrations/000009_tenant_keys'
import { freeHostsMigration } from '../../../server/fuma/db/migrations/000022_free_hosts'
import { freeHostAuthorityMigration } from '../../../server/fuma/db/migrations/000043_free_host_authority'
import { freeHostRootDomainPortabilityMigration } from '../../../server/fuma/db/migrations/000082_free_host_root_domain_portability'
import { PostgresCustomerOrganizationLifecycle } from '../../../server/fuma/organizations/customerLifecycle'
import { HostedSiteOnboardingError, HostedSiteOnboardingService } from '../../../server/fuma/onboarding/hostedSiteProvisioning'
import { PostgresAccessibleContextCatalog } from '../../../server/fuma/context/accessibleCatalog'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema identifier.')
  return `"${value}"`
}
function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
async function withDatabase(run: (db: ReturnType<typeof createPostgresClient>) => Promise<void>) {
  if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
  const admin = createPostgresClient(postgresUrl)
  const schema = `onboard_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  await admin.unsafe(`create schema ${quote(schema)}`)
  const db = createPostgresClient(scoped(postgresUrl, schema))
  try {
    for (const migration of [
      staffIdentityMigration,
      organizationsMigration,
      workspacesMigration,
      sitesMigration,
      tenantKeysMigration,
      freeHostsMigration,
      freeHostAuthorityMigration,
      freeHostRootDomainPortabilityMigration,
    ]) {
      await db.unsafe(migration.sql)
    }
    await db`
      insert into auth_users(id,name,email,email_verified,role)
      values('owner-user','Owner','owner@example.com',true,'user'),
        ('member-user','Member','member@example.com',true,'user')`
    await db`
      insert into auth_organizations(id,name,slug,created_at,metadata)
      values('org-customer','Customer Studio','customer-studio',now(),'{}')`
    await db`
      insert into auth_members(id,organization_id,user_id,role,created_at)
      values('membership-owner','org-customer','owner-user','owner',now()),
        ('membership-member','org-customer','member-user','member',now())`
    await run(db)
  } finally {
    await db.close?.()
    await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`).catch(() => {})
    await admin.close?.()
  }
}

function onboarding(db: ReturnType<typeof createPostgresClient>): HostedSiteOnboardingService {
  return new HostedSiteOnboardingService(db, '.trimly.co.ke')
}

describe('hosted customer organization and first-site composition', () => {
  test.skipIf(!postgresUrl)('applies policy-backed organization sidecars idempotently and repairs interrupted hooks', async () => {
    await withDatabase(async (db) => {
      const lifecycle = new PostgresCustomerOrganizationLifecycle(db)
      const approved = await lifecycle.beforeCreate({
        organization: { name: 'Second Studio', slug: 'second-studio' },
        user: { id: 'owner-user' },
      })
      expect(approved.data).toMatchObject({ name: 'Second Studio', slug: 'second-studio' })
      expect(approved.data.metadata).toMatchObject({ fumaOrganizationClass: 'customer' })

      // Simulates Better Auth having committed an organization before an old
      // process crashed prior to its after-create lifecycle.
      await db`
        insert into auth_organizations(id,name,slug,created_at,metadata)
        values('org-interrupted','Interrupted','interrupted',now(),'{}')`
      await db`
        insert into auth_members(id,organization_id,user_id,role,created_at)
        values('membership-interrupted','org-interrupted','owner-user','owner',now())`
      await lifecycle.reconcileOwned('owner-user')
      await lifecycle.reconcileOwned('owner-user')

      const rows = await db<Readonly<{
        kind: string; status: string; max_workspaces: number; max_sites: number; max_staff: number
      }>>`
        select profile.kind,profile.status,limits.max_workspaces,limits.max_sites,limits.max_staff
        from fuma_organization_profiles profile
        join fuma_organization_limits limits on limits.organization_id=profile.organization_id
        where profile.organization_id='org-interrupted'`
      expect(rows.rows).toEqual([{ kind: 'customer', status: 'active', max_workspaces: 3, max_sites: 10, max_staff: 25 }])
    })
  })

  test.skipIf(!postgresUrl)('creates workspace, site and owner authority atomically and replays idempotently', async () => {
    await withDatabase(async (db) => {
      const lifecycle = new PostgresCustomerOrganizationLifecycle(db)
      await lifecycle.afterCreate({
        organization: { id: 'org-customer', name: 'Customer Studio', slug: 'customer-studio' },
        member: { organizationId: 'org-customer', userId: 'owner-user', role: 'owner' },
        user: { id: 'owner-user' },
      })
      const service = onboarding(db)
      const input = {
        organizationId: 'org-customer',
        siteName: 'My Fuma Site',
        siteSlug: 'my-fuma-site',
        profileId: 'website' as const,
      }
      const created = await service.provision('owner-user', input)
      expect(created.created).toEqual({ workspace: true, site: true, ownerKey: true, freeHost: true })
      expect(created.siteSlug).toBe('my-fuma-site')
      expect(created.host).toBe('my-fuma-site.trimly.co.ke')

      const replay = await service.provision('owner-user', input)
      expect(replay).toMatchObject({
        organizationId: created.organizationId,
        workspaceId: created.workspaceId,
        siteId: created.siteId,
        created: { workspace: false, site: false, ownerKey: false, freeHost: false },
      })
      const limited = new HostedSiteOnboardingService(db, '.trimly.co.ke', { limits: async () => ({ sites: 1, pages: 2 }) })
      await expect(limited.provision('owner-user', { organizationId: 'org-customer', siteName: 'Second Site', siteSlug: 'second-site', profileId: 'website' })).rejects.toThrow('free tier one-site')

      const counts = await db<Readonly<{ workspaces: number; sites: number; owners: number; hosts: number }>>`
        select
          (select count(*)::int from fuma_workspaces) workspaces,
          (select count(*)::int from fuma_sites) sites,
          (select count(*)::int from fuma_tenant_owner_keys) owners,
          (select count(*)::int from fuma_free_hosts_v2) hosts`
      expect(counts.rows[0]).toEqual({ workspaces: 1, sites: 1, owners: 1, hosts: 1 })

      const catalog = await new PostgresAccessibleContextCatalog(db).read('owner-user')
      expect(catalog.organizations.map((value) => value.id)).toEqual(['org-customer'])
      expect(catalog.workspaces.map((value) => value.id)).toEqual([created.workspaceId])
      expect(catalog.sites.map((value) => value.id)).toEqual([created.siteId])
    })
  })

  test.skipIf(!postgresUrl)('denies non-owners and conflicting profile replays without partial writes', async () => {
    await withDatabase(async (db) => {
      const lifecycle = new PostgresCustomerOrganizationLifecycle(db)
      await lifecycle.afterCreate({
        organization: { id: 'org-customer', name: 'Customer Studio', slug: 'customer-studio' },
        member: { organizationId: 'org-customer', userId: 'owner-user', role: 'owner' },
        user: { id: 'owner-user' },
      })
      const service = onboarding(db)
      await expect(service.provision('member-user', {
        organizationId: 'org-customer', siteName: 'Denied', profileId: 'website',
      })).rejects.toMatchObject({ status: 403 })

      const original = await service.provision('owner-user', {
        organizationId: 'org-customer', siteName: 'Editorial', siteSlug: 'editorial', profileId: 'website',
      })
      const conflict = service.provision('owner-user', {
        organizationId: 'org-customer', siteName: 'Editorial', siteSlug: 'editorial', profileId: 'publication',
      })
      await expect(conflict).rejects.toBeInstanceOf(HostedSiteOnboardingError)
      await conflict.catch((error: unknown) => expect((error as HostedSiteOnboardingError).status).toBe(409))
      const sites = await db<Readonly<{ id: string; profile_id: string }>>`select id,profile_id from fuma_sites`
      expect(sites.rows).toEqual([{ id: original.siteId, profile_id: 'website' }])
    })
  })
})
