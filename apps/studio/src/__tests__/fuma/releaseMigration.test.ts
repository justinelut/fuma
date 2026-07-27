import { describe, expect, it } from 'bun:test'
import { releasesMigration } from '../../../server/fuma/db/migrations/000011_releases'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'

const RELEASES_CHECKSUM = '1314bb5e96680363917b95f3ed3c46bfd9364519043b7698726a1758959c793b'
const PRIOR_CHECKSUMS = Object.freeze({
  '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
  '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
  '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
  '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
  '000005_workspaces': '0d24040f7454107b1891a9fe91b44d33f08515c272b3b3a0e57ce2fa840d4ad2',
  '000006_sites': 'b767a08415ba95afb34acd0c3ff8728c027eb6ad12f1598490a05d32d98d332f',
  '000007_audit_history': '0823e4e3592bb5b6347d85e04cab85367c313a9753aea4fb7bc0e7753bc1d07e',
  '000008_transfer_saga': '04ab1226ce0010a06183847d6feec927ab4d583fcafdf69321d70bab1686e852',
  '000009_tenant_keys': '43e27fb6a3d46bb76e9e47be448fa58a6bada9aad86e7a4451f49daec566964a',
  '000010_editor_resources': '71f39c0c8fbbd4fdd1aa6686ad098a5fb53ea01b562ee0548e4458d8ba1027e1',
})

function compact(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

describe('FUMA-048 release hosted migration', () => {
  it('inserts and checksum-finalizes migration 000011 after immutable 000010', () => {
    const releaseIndex = hostedMigrations.indexOf(releasesMigration)
    expect(releaseIndex).toBeGreaterThan(0)
    expect(hostedMigrations[releaseIndex - 1]?.id).toBe('000010_editor_resources')
    expect(runnableHostedMigrations).toContain(releasesMigration)
    expect(nextHostedMigrationId(hostedMigrations, 'release followup'))
      .toBe('000060_release_followup')
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject(PRIOR_CHECKSUMS)
    expect(HOSTED_MIGRATION_CHECKSUMS[releasesMigration.id]).toBe(RELEASES_CHECKSUM)
    expect(hostedMigrationChecksum(releasesMigration.sql)).toBe(RELEASES_CHECKSUM)
    expect(() => assertHostedMigrationIsAdditive(releasesMigration)).not.toThrow()
    expect(() => assertHostedMigrationManifest(
      hostedMigrations,
      HOSTED_MIGRATION_CHECKSUMS,
    )).not.toThrow()
  })

  it('creates immutable releases, one exact-site pointer, and retention roots', () => {
    const sql = compact(releasesMigration.sql)
    expect(sql).toContain('create table fuma_releases')
    expect(sql).toContain("status in ('queued', 'building', 'ready', 'active', 'failed')")
    expect(sql).toContain('primary key (platform_id, owner_key, release_id)')
    expect(sql).toContain('foreign key (platform_id, owner_key, organization_id, workspace_id, site_id) references fuma_tenant_owner_keys')
    expect(sql).toContain('on update cascade on delete restrict')
    expect(sql).toContain('create table fuma_release_active_pointers')
    expect(sql).toContain('fuma_release_active_pointers_site_unique unique ( platform_id, organization_id, workspace_id, site_id )')
    expect(sql).toContain('create table fuma_release_retention_roots')
    expect(sql).toContain("kind text not null check (kind in ('active', 'manual'))")
    expect(sql).toContain("where kind = 'active'")
  })

  it('enforces immutable identity/manifest, monotonic versions, legal transitions, and active deletion denial', () => {
    const sql = compact(releasesMigration.sql)
    expect(sql).toContain('create function fuma_releases_enforce_immutability()')
    expect(sql).toContain("raise exception 'release identity is immutable'")
    expect(sql).toContain("raise exception 'release ancestry may change only through owner-key cascade'")
    expect(sql).toContain('new.organization_id is distinct from old.organization_id')
    expect(sql).toContain('new.version = old.version')
    expect(sql).toContain("raise exception 'release manifest is immutable'")
    expect(sql).toContain("raise exception 'invalid release lifecycle transition'")
    expect(sql).toContain("raise exception 'active releases cannot be deleted'")
    expect(sql).toContain('new.version <> old.version + 1')
    expect(sql).toContain("old.status = 'queued' and new.status in ('building', 'failed')")
    expect(sql).toContain("old.status = 'building' and new.status in ('ready', 'failed')")
    expect(sql).toContain("old.status = 'ready' and new.status = 'active'")
    expect(sql).toContain("old.status = 'active' and new.status = 'ready'")
  })
})
