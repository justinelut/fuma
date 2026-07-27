import { describe, expect, it } from 'bun:test'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { hostedMigrations, HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  HOSTED_SITE_SCHEMA_MANIFEST,
  SITE_AUTHORITY_TABLES,
  SITE_CAPABILITY_OVERRIDE_KEYS,
  SITE_PROFILE_COLUMNS,
  SITE_RESERVED_SLUGS,
  SITE_STATUSES,
  SITE_TABLE_NAMES,
} from '../../../server/fuma/sites/schemaManifest'

const normalizedSql = sitesMigration.sql.replace(/\s+/g, ' ').trim()

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing site migration table: ${table}`)
  return match[1]
}

describe('FUMA-016 site schema migration', () => {
  it('locates migration 000006 in immutable history without assuming it remains last', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === sitesMigration.id)
    expect(migrationIndex).toBeGreaterThanOrEqual(0)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'sites'))
      .toBe('000006_sites')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
      '000006_sites',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject({
      '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
      '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
      '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
      '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
      '000005_workspaces': '0d24040f7454107b1891a9fe91b44d33f08515c272b3b3a0e57ce2fa840d4ad2',
      '000006_sites': 'b767a08415ba95afb34acd0c3ff8728c027eb6ad12f1598490a05d32d98d332f',
    })
    expect(HOSTED_SITE_SCHEMA_MANIFEST.migrationId).toBe(sitesMigration.id)
    expect(hostedMigrationChecksum(sitesMigration.sql))
      .toBe(HOSTED_MIGRATION_CHECKSUMS[sitesMigration.id])
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
    expect(() => assertHostedMigrationIsAdditive(sitesMigration)).not.toThrow()
  })

  it('adds one site table and no new organization, workspace, or profile authority', () => {
    expect(SITE_AUTHORITY_TABLES).toEqual({
      organization: 'auth_organizations',
      workspace: 'fuma_workspaces',
    })
    expect(SITE_TABLE_NAMES).toEqual({ site: 'fuma_sites' })
    expect(normalizedSql.match(/create table /g)).toHaveLength(1)
    expect(normalizedSql).not.toMatch(/create table (?:auth_organizations|fuma_workspaces)/i)
    expect(normalizedSql).not.toMatch(/create table [a-z0-9_]*profiles/i)
  })

  it('enforces organization and workspace coherence with restrictive composite foreign keys', () => {
    const definition = tableDefinition(SITE_TABLE_NAMES.site)
    expect(normalizedSql).toContain(
      'alter table fuma_workspaces add constraint fuma_workspaces_organization_id_id_unique unique (organization_id, id)',
    )
    expect(definition).toContain(
      'organization_id text not null references auth_organizations(id) on delete restrict',
    )
    expect(definition).toContain('foreign key (organization_id, workspace_id)')
    expect(definition).toContain('references fuma_workspaces(organization_id, id) on delete restrict')
    expect(definition).not.toMatch(/workspace_id text[^,]*references fuma_workspaces\(id\)/i)
  })

  it('preserves caller-provided text IDs in tenant-qualified keys', () => {
    const definition = tableDefinition(SITE_TABLE_NAMES.site)
    expect(definition).toContain("id text not null check (btrim(id) <> '')")
    expect(definition).toContain('primary key (organization_id, workspace_id, id)')
    expect(definition).not.toMatch(/\bid\b[^,]*(?:generated|default|uuid|serial|identity)/i)
  })

  it('persists the validated profile assignment shape in correctly named JSONB storage', () => {
    const definition = tableDefinition(SITE_TABLE_NAMES.site)
    expect(SITE_PROFILE_COLUMNS).toEqual({
      profileId: 'profile_id',
      capabilityOverrides: 'capability_overrides_json',
    })
    expect(SITE_CAPABILITY_OVERRIDE_KEYS).toEqual(['grant', 'revoke'])
    expect(definition).toContain("profile_id text not null check (btrim(profile_id) <> '')")
    expect(definition).toContain(
      `capability_overrides_json jsonb not null default '{"grant":[],"revoke":[]}'::jsonb`,
    )
    expect(definition).toContain("jsonb_typeof(capability_overrides_json -> 'grant') = 'array'")
    expect(definition).toContain("jsonb_typeof(capability_overrides_json -> 'revoke') = 'array'")
    expect(definition).toContain('capability_overrides_json = jsonb_build_object(')
    expect(definition).not.toMatch(/\bcapability_(?:overrides|grants?|revokes?)\b(?!_json)/i)
  })

  it('enforces status and normalized, non-reserved, workspace-qualified slug lifecycle', () => {
    const definition = tableDefinition(SITE_TABLE_NAMES.site)
    expect(SITE_STATUSES).toEqual(['active', 'archived'])
    expect(SITE_RESERVED_SLUGS).toEqual([
      'admin',
      'api',
      'assets',
      'health',
      'instatic',
      'uploads',
    ])
    expect(definition).toContain(
      "status text not null default 'active' check (status in ('active', 'archived'))",
    )
    expect(definition).toContain("check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')")
    expect(definition).toContain(
      "check (slug not in ('admin', 'api', 'assets', 'health', 'instatic', 'uploads'))",
    )
    expect(normalizedSql).toContain(
      'create unique index fuma_sites_workspace_slug_unique on fuma_sites (organization_id, workspace_id, lower(slug))',
    )
    expect(normalizedSql).not.toMatch(
      /create unique index [^;]+ on fuma_sites \((?:lower\(slug\)|workspace_id, lower\(slug\))\)/i,
    )
  })
})
