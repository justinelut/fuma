import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { siteRuntimeApplicationMigration } from '../../../server/fuma/db/migrations/000072_site_runtime_application'
import { PostgresSiteRuntimeApplicationRepository } from '../../../server/fuma/siteRuntime/postgresApplication'
import type { SiteRuntimeExactBinding, SiteRuntimeMutationReceipt } from '../../../server/fuma/siteRuntime/application'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const quote = (value: string) => { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
const scoped = (connection: string, schema: string) => { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }
const binding: SiteRuntimeExactBinding = {
  host: 'alpha.trimly.co.ke', platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 1,
  releaseId: 'release-react', releaseHashSha256: 'a'.repeat(64),
}

async function prerequisites(db: ReturnType<typeof createPostgresClient>) {
  await db.unsafe(`
    create table fuma_tenant_owner_keys (
      platform_id text not null, owner_key text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      generation bigint not null, primary key(platform_id,owner_key), unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
    );
    create table fuma_releases (
      platform_id text not null, owner_key text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      release_id text not null, primary key(platform_id,owner_key,organization_id,workspace_id,site_id,release_id)
    );
  `)
  await db`insert into fuma_tenant_owner_keys values (${binding.platformId},${binding.ownerKey},${binding.organizationId},${binding.workspaceId},${binding.siteId},${binding.ownerGeneration})`
  await db`insert into fuma_releases values (${binding.platformId},${binding.ownerKey},${binding.organizationId},${binding.workspaceId},${binding.siteId},${binding.releaseId})`
  await db`insert into fuma_releases values (${binding.platformId},${binding.ownerKey},${binding.organizationId},${binding.workspaceId},${binding.siteId},'release-legacy')`
}

describe('FUMA-SITE-005 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('applies 000072 with policy CAS, retained release binding, immutable receipts, and cleanup', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_site_app_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await prerequisites(db)
      await db.unsafe(siteRuntimeApplicationMigration.sql)
      const repository = new PostgresSiteRuntimeApplicationRepository(db)
      const first = { route: '/book', target: 'react' as const, shadow: 'compare' as const, fallback: 'legacy' as const, legacyReleaseId: 'release-legacy', version: 1 }
      expect(await repository.put(binding, first, null)).toBe(true)
      expect(await repository.put(binding, { ...first, version: 2 }, null)).toBe(false)
      expect(await repository.get(binding, '/book')).toEqual(first)
      const second = { ...first, target: 'legacy' as const, shadow: 'off' as const, version: 2 }
      expect(await repository.put(binding, second, 1)).toBe(true)
      expect(await repository.put(binding, { ...second, version: 3 }, 1)).toBe(false)
      expect(await repository.get(binding, '/book')).toEqual(second)
      const response = { accepted: true as const, duplicate: false, mutationId: 'mutation-a', snapshot: { version: 1, cart: { items: [{ itemId: 'room-a', quantity: 1 }] }, booking: { selections: [] }, account: null } }
      const receipt: SiteRuntimeMutationReceipt = { binding, memberId: 'member-a', idempotencyKey: 'site-mutation:key-a', requestHashSha256: 'b'.repeat(64), response, createdAt: '2026-07-30T12:00:00.000Z' }
      expect(await repository.put(receipt)).toBe(true)
      expect(await repository.put(receipt)).toBe(false)
      expect(await repository.get(binding, receipt.memberId, receipt.idempotencyKey)).toEqual(receipt)
      await expect(db`update fuma_site_runtime_mutation_receipts_v2 set request_hash_sha256=${'c'.repeat(64)} where idempotency_key=${receipt.idempotencyKey}`).rejects.toThrow('append-only')
      await expect(db`delete from fuma_site_runtime_mutation_receipts_v2 where idempotency_key=${receipt.idempotencyKey}`).rejects.toThrow('append-only')
      await expect(db`insert into fuma_site_runtime_route_policies_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,route,target,shadow,fallback,legacy_release_id,policy_version,updated_at) values(${binding.platformId},${binding.organizationId},${binding.workspaceId},${binding.siteId},${binding.ownerKey},${binding.ownerGeneration},'/missing','legacy','off','legacy','missing-release',1,now())`).rejects.toThrow()
      const counts = await db<{ policies: string | number | bigint; receipts: string | number | bigint }>`select (select count(*) from fuma_site_runtime_route_policies_v2) as policies,(select count(*) from fuma_site_runtime_mutation_receipts_v2) as receipts`
      expect({ policies: Number(counts.rows[0]?.policies), receipts: Number(counts.rows[0]?.receipts) }).toEqual({ policies: 1, receipts: 1 })
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string | number | bigint }>`select count(*) as count from pg_namespace where nspname=${schema}`
      expect(Number(leftover.rows[0]?.count ?? 0)).toBe(0)
    }
  }, 120_000)
})
