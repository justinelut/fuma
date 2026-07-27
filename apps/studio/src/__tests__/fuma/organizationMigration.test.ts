import { describe, expect, it } from 'bun:test'
import { organizationsMigration } from '../../../server/fuma/db/migrations/000004_organizations'
import { hostedMigrations, HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  HOSTED_ORGANIZATION_SCHEMA_MANIFEST,
  ORGANIZATION_AUTHORITY_TABLES,
  ORGANIZATION_KINDS,
  ORGANIZATION_PLACEMENT_CLASSES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TABLE_NAMES,
} from '../../../server/fuma/organizations/schemaManifest'

const normalizedSql = organizationsMigration.sql.replace(/\s+/g, ' ').trim()

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing organization migration table: ${table}`)
  return match[1]
}

describe('FUMA-014 organization schema migration', () => {
  it('appends migration 000004 without changing prior hosted history', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === organizationsMigration.id)
    expect(migrationIndex).toBe(3)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'organizations'))
      .toBe('000004_organizations')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject({
      '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
      '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
      '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
    })
    expect(HOSTED_ORGANIZATION_SCHEMA_MANIFEST.migrationId).toBe(organizationsMigration.id)
    expect(hostedMigrationChecksum(organizationsMigration.sql))
      .toBe(HOSTED_MIGRATION_CHECKSUMS[organizationsMigration.id])
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
    expect(() => assertHostedMigrationIsAdditive(organizationsMigration)).not.toThrow()
  })

  it('keeps Better Auth tables authoritative and adds only the four Fuma organization extensions', () => {
    expect(ORGANIZATION_AUTHORITY_TABLES).toEqual({
      identity: 'auth_organizations',
      membership: 'auth_members',
      invitation: 'auth_invitations',
    })
    expect(Object.values(ORGANIZATION_TABLE_NAMES)).toEqual([
      'fuma_organization_profiles',
      'fuma_organization_limits',
      'fuma_organization_placements',
      'fuma_organization_bootstrap_receipts',
    ])
    expect(normalizedSql.match(/create table /g)).toHaveLength(4)
    expect(normalizedSql).not.toMatch(/create table auth_(?:organizations|members|invitations)/i)

    for (const table of Object.values(ORGANIZATION_TABLE_NAMES)) {
      expect(normalizedSql).toContain(`create table ${table}`)
    }
  })

  it('enforces organization profile kinds, lifecycle statuses, and restrictive ownership', () => {
    const definition = tableDefinition(ORGANIZATION_TABLE_NAMES.profile)
    expect(ORGANIZATION_KINDS).toEqual(['platform', 'customer'])
    expect(ORGANIZATION_STATUSES).toEqual(['active', 'suspended', 'archived'])
    expect(definition).toContain(
      'organization_id text primary key references auth_organizations(id) on delete restrict',
    )
    expect(definition).toContain("kind text not null check (kind in ('platform', 'customer'))")
    expect(definition).toContain(
      "status text not null check (status in ('active', 'suspended', 'archived'))",
    )
    expect(definition).toContain('created_at timestamptz not null default current_timestamp')
    expect(definition).toContain('updated_at timestamptz not null default current_timestamp')
  })

  it('requires positive organization limits without per-resource allocations', () => {
    const definition = tableDefinition(ORGANIZATION_TABLE_NAMES.limits)
    expect(definition).toContain(
      'organization_id text primary key references auth_organizations(id) on delete restrict',
    )
    for (const column of ['max_workspaces', 'max_sites', 'max_staff']) {
      expect(definition).toContain(`${column} integer not null check (${column} > 0)`)
    }
    expect(normalizedSql).not.toMatch(
      /(?:database|cache|bucket|process|worker|scheduler|edge)_(?:id|key|allocation)/i,
    )
  })

  it('constrains placement identity while leaving launch defaults to services', () => {
    const definition = tableDefinition(ORGANIZATION_TABLE_NAMES.placement)
    expect(ORGANIZATION_PLACEMENT_CLASSES).toEqual(['shared', 'dedicated'])
    expect(definition).toContain(
      'organization_id text primary key references auth_organizations(id) on delete restrict',
    )
    expect(definition).toContain(
      "placement_class text not null check (placement_class in ('shared', 'dedicated'))",
    )
    expect(definition).toContain("placement_key text not null check (btrim(placement_key) <> '')")
    expect(definition).not.toMatch(/placement_(?:class|key)[^,]*\bdefault\b/i)
  })

  it('makes bootstrap idempotency and authority references durable and restrictive', () => {
    const definition = tableDefinition(ORGANIZATION_TABLE_NAMES.bootstrapReceipt)
    expect(definition).toContain('bootstrap_key text primary key')
    expect(definition).toContain(
      'organization_id text not null unique references auth_organizations(id) on delete restrict',
    )
    expect(definition).toContain(
      'owner_user_id text not null references auth_users(id) on delete restrict',
    )
    expect(definition).toContain('created_at timestamptz not null default current_timestamp')
  })
})
