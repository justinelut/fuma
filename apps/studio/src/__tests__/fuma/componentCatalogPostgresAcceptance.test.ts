import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { componentCatalogAuthorityMigration } from '../../../server/fuma/db/migrations/000075_component_catalog_authority'
import {
  PostgresComponentCatalogRepository,
  IsolatedRestrictedClientValidator,
  type ComponentCatalogAuditFact,
  type ComponentCatalogRelease,
  type ComponentCatalogScope,
  type ComponentInstallation,
  type ComponentSourceDraftRecord,
  type ComponentUpgradeReceipt,
  type ComponentUsage,
} from '../../../server/fuma/componentCatalog'
import { hashContract, releaseCoordinate } from '../../../../../tooling/component-packs/contracts'
import { draft, NOW, release, scope } from './componentCatalogFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

function releaseRecord(): ComponentCatalogRelease {
  const value = release()
  return { scope, coordinate: releaseCoordinate(value), previousCoordinate: null, release: value, origin: 'private', state: 'active', actorId: 'actor-pg', createdAt: NOW }
}
function installationRecord(version = 1): ComponentInstallation {
  const value = release()
  return { scope, installationId: 'installation-pg', packageKey: 'test.owner/hero', coordinate: releaseCoordinate(value), integritySha256: value.immutableArtifact.integritySha256, source: 'private', artifactInstallationId: null, artifactId: null, reviewSubmissionId: null, rollbackCoordinates: [], version, installedAt: NOW, updatedAt: NOW }
}
function usageRecord(): ComponentUsage {
  return { scope, usageId: 'usage-pg', coordinate: 'test.owner/hero@1.0.0', kind: 'page-node', resourceId: 'home', nodeId: 'home-root', variantId: null, props: { heading: 'Owned' }, createdAt: NOW }
}
function receiptRecord(): ComponentUpgradeReceipt {
  return { scope, receiptId: 'receipt-pg', installationId: 'installation-pg', fromCoordinate: 'test.owner/hero@1.0.0', toCoordinate: 'test.owner/hero@1.1.0', diffHashSha256: 'd'.repeat(64), rollbackCoordinate: 'test.owner/hero@1.0.0', affectedUsageIds: ['usage-pg'], ownerConfirmed: true, actorId: 'actor-pg', createdAt: NOW }
}
function auditRecord(): ComponentCatalogAuditFact {
  return { auditId: 'audit-pg', scope, actorId: 'actor-pg', action: 'component.private.created', coordinate: 'test.owner/hero@1.0.0', operationId: 'operation-pg', outcome: 'success', reasonCode: null, occurredAt: NOW }
}

async function draftRecord(): Promise<ComponentSourceDraftRecord> {
  const value = draft()
  const { audit, validation } = await new IsolatedRestrictedClientValidator().validate(value)
  return {
    scope,
    actorId: 'actor-pg',
    draft: value,
    validation,
    disclosure: { draftId: value.draftId, permissions: value.requestedPermissions, dependencyLockSha256: hashContract(value.exactDependencies), disclosedAt: NOW, disclosedToOwnerKey: scope.ownerKey },
    sourceAuditHashSha256: hashContract(audit),
    state: 'validated',
    createdAt: NOW,
    confirmedAt: null,
  }
}

describe('FUMA-SITE-008 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes catalog writes, preserves immutable evidence, and invalidates transferred scope', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_component_catalog_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table fuma_tenant_owner_keys (
          platform_id text not null, owner_key text not null, organization_id text not null,
          workspace_id text not null, site_id text not null, state text not null,
          generation bigint not null, transfer_id text null, created_at timestamptz not null,
          updated_at timestamptz not null,
          primary key(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
        );
      `)
      await db`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,state,generation,created_at,updated_at)
        values (${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},'active',${scope.ownerGeneration},${NOW},${NOW})`
      await db.unsafe(componentCatalogAuthorityMigration.sql)
      const repository = new PostgresComponentCatalogRepository(db)

      const releaseResults = await Promise.all(Array.from({ length: 8 }, () => repository.putRelease(releaseRecord())))
      expect(releaseResults.filter((value) => value === 'inserted')).toHaveLength(1)
      expect(releaseResults.filter((value) => value === 'replay')).toHaveLength(7)
      expect(await repository.putRelease({ ...releaseRecord(), actorId: 'actor-mutated' })).toBe('conflict')

      const source = await draftRecord()
      expect(await repository.putDraft(source)).toBe('inserted')
      const confirmations = await Promise.all(Array.from({ length: 8 }, () => repository.confirmDraft(scope, source.draft.draftId, NOW)))
      expect(confirmations.filter(Boolean)).toHaveLength(1)

      const installs = await Promise.all(Array.from({ length: 8 }, () => repository.putInstallation(installationRecord(), null)))
      expect(installs.every(Boolean)).toBe(true)
      const installationUpdates = await Promise.all(Array.from({ length: 8 }, () => repository.putInstallation(installationRecord(2), 1)))
      expect(installationUpdates.filter(Boolean)).toHaveLength(1)

      const usages = await Promise.all(Array.from({ length: 8 }, () => repository.putUsage(usageRecord())))
      expect(usages.filter((value) => value === 'inserted')).toHaveLength(1)
      expect(usages.filter((value) => value === 'replay')).toHaveLength(7)
      expect(await repository.putUpgradeReceipt(receiptRecord())).toBe('inserted')
      await repository.appendAudit(auditRecord())

      await expect(db`update fuma_component_catalog_releases_v1 set release_json=release_json || '{"actorId":"tampered"}'::jsonb`).rejects.toThrow('append-only')
      await expect(db`delete from fuma_component_catalog_usage_v1`).rejects.toThrow('append-only')
      await expect(db`update fuma_component_upgrade_receipts_v1 set receipt_json='{}'::jsonb`).rejects.toThrow('append-only')
      await expect(db`delete from fuma_component_catalog_audit_v1`).rejects.toThrow('immutable')
      await expect(db`update fuma_component_source_drafts_v1 set state='validated'`).rejects.toThrow('illegal')

      const foreign: ComponentCatalogScope = { ...scope, siteId: 'site-foreign' }
      expect(await repository.release(foreign, 'test.owner/hero@1.0.0')).toBeNull()

      await db`update fuma_tenant_owner_keys set owner_key='owner-destination',organization_id='organization-destination',workspace_id='workspace-destination',site_id='site-destination',generation=4,updated_at=${NOW} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey}`
      expect(await repository.release(scope, 'test.owner/hero@1.0.0')).toBeNull()
      const destination: ComponentCatalogScope = { platformId: scope.platformId, organizationId: 'organization-destination', workspaceId: 'workspace-destination', siteId: 'site-destination', ownerKey: 'owner-destination', ownerGeneration: 4, profileId: scope.profileId }
      await expect(repository.release(destination, 'test.owner/hero@1.0.0')).rejects.toMatchObject({ code: 'not-found' })

      const counts = await db<{ releases: string; drafts: string; installations: string; usages: string; receipts: string; audits: string }>`select
        (select count(*) from fuma_component_catalog_releases_v1)::text releases,
        (select count(*) from fuma_component_source_drafts_v1)::text drafts,
        (select count(*) from fuma_component_catalog_installations_v1)::text installations,
        (select count(*) from fuma_component_catalog_usage_v1)::text usages,
        (select count(*) from fuma_component_upgrade_receipts_v1)::text receipts,
        (select count(*) from fuma_component_catalog_audit_v1)::text audits`
      expect(counts.rows[0]).toEqual({ releases: '1', drafts: '1', installations: '1', usages: '1', receipts: '1', audits: '1' })
      process.stdout.write('[FUMA-SITE-008 PostgreSQL demo] concurrent=8 release=1 draft=1 installation=1 usage=1 receipt=1 audit=1 transfer=invalidated\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
