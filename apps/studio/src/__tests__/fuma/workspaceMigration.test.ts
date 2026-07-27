import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { hostedMigrations, HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  WorkspaceArchiveInputSchema,
  WorkspaceCreateInputSchema,
  WorkspaceMembershipOverrideInputSchema,
  WorkspaceMembershipOverrideRecordSchema,
  WorkspaceRecordSchema,
  WorkspaceRestoreInputSchema,
  WorkspaceSlugSchema,
  WorkspaceUpdateInputSchema,
  normalizeWorkspaceSlug,
} from '../../../server/fuma/workspaces/contracts'
import {
  HOSTED_WORKSPACE_SCHEMA_MANIFEST,
  WORKSPACE_AUTHORITY_TABLES,
  WORKSPACE_MEMBERSHIP_ACCESS_MODES,
  WORKSPACE_ROLES,
  WORKSPACE_STATUSES,
  WORKSPACE_TABLE_NAMES,
} from '../../../server/fuma/workspaces/schemaManifest'

const normalizedSql = workspacesMigration.sql.replace(/\s+/g, ' ').trim()
const now = '2026-07-24T18:00:00.000Z'

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing workspace migration table: ${table}`)
  return match[1]
}

describe('FUMA-015 workspace schema and contracts', () => {
  it('appends migration 000005 without changing prior hosted history', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === workspacesMigration.id)
    expect(migrationIndex).toBe(4)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'workspaces'))
      .toBe('000005_workspaces')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject({
      '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
      '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
      '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
      '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
    })
    expect(HOSTED_WORKSPACE_SCHEMA_MANIFEST.migrationId).toBe(workspacesMigration.id)
    expect(hostedMigrationChecksum(workspacesMigration.sql))
      .toBe(HOSTED_MIGRATION_CHECKSUMS[workspacesMigration.id])
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
    expect(() => assertHostedMigrationIsAdditive(workspacesMigration)).not.toThrow()
  })

  it('adds only organization-owned workspaces and membership overrides', () => {
    expect(WORKSPACE_AUTHORITY_TABLES).toEqual({
      organization: 'auth_organizations',
      user: 'auth_users',
    })
    expect(Object.values(WORKSPACE_TABLE_NAMES)).toEqual([
      'fuma_workspaces',
      'fuma_workspace_membership_overrides',
    ])
    expect(normalizedSql.match(/create table /g)).toHaveLength(2)
    expect(normalizedSql).not.toMatch(/create table auth_(?:organizations|users)/i)
    expect(normalizedSql).not.toMatch(
      /(?:database|cache|bucket|process|worker|scheduler|edge)_(?:id|key|allocation)/i,
    )
  })

  it('enforces workspace ownership, lifecycle, normalized slugs, and one default per organization', () => {
    const definition = tableDefinition(WORKSPACE_TABLE_NAMES.workspace)
    expect(WORKSPACE_STATUSES).toEqual(['active', 'archived'])
    expect(definition).toContain('id text primary key')
    expect(definition).toContain(
      'organization_id text not null references auth_organizations(id) on delete restrict',
    )
    expect(definition).toContain("status text not null default 'active' check (status in ('active', 'archived'))")
    expect(definition).toContain('is_default boolean not null default false')
    expect(definition).toContain("check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')")
    expect(normalizedSql).toContain(
      'create unique index fuma_workspaces_organization_default_unique on fuma_workspaces (organization_id) where is_default',
    )
  })

  it('qualifies case-insensitive slug uniqueness by organization so equal slugs can exist in different tenants', () => {
    expect(normalizedSql).toContain(
      'create unique index fuma_workspaces_organization_slug_unique on fuma_workspaces (organization_id, lower(slug))',
    )
    expect(normalizedSql).not.toMatch(
      /create unique index [^;]+ on fuma_workspaces \(lower\(slug\)\)/i,
    )

    const scopedKeys = new Set([
      ['org-a', 'Newsroom'].map((part) => part.toLowerCase()).join(':'),
      ['org-b', 'newsroom'].map((part) => part.toLowerCase()).join(':'),
    ])
    expect(scopedKeys.size).toBe(2)
  })

  it('enforces restrictive override ownership and coherent access roles', () => {
    const definition = tableDefinition(WORKSPACE_TABLE_NAMES.membershipOverride)
    expect(WORKSPACE_MEMBERSHIP_ACCESS_MODES).toEqual(['inherit', 'grant', 'deny'])
    expect(WORKSPACE_ROLES).toEqual(['owner', 'admin', 'editor', 'viewer'])
    expect(definition).toContain(
      'workspace_id text not null references fuma_workspaces(id) on delete restrict',
    )
    expect(definition).toContain(
      'user_id text not null references auth_users(id) on delete restrict',
    )
    expect(definition).toContain('primary key (workspace_id, user_id)')
    expect(definition).toContain("access text not null check (access in ('inherit', 'grant', 'deny'))")
    expect(definition).toContain(
      "role text null check (role is null or role in ('owner', 'admin', 'editor', 'viewer'))",
    )
    expect(definition).toContain("(access = 'grant' and role is not null)")
    expect(definition).toContain("(access in ('inherit', 'deny') and role is null)")
  })

  it('normalizes and validates lowercase kebab workspace slugs', () => {
    expect(normalizeWorkspaceSlug('  Éditorial News / 2026  ')).toBe('editorial-news-2026')
    expect(Value.Check(WorkspaceSlugSchema, 'editorial-news-2026')).toBe(true)
    expect(Value.Check(WorkspaceSlugSchema, 'Editorial News')).toBe(false)
  })

  it('validates create, non-empty update, lifecycle, override, and record contracts', () => {
    expect(Value.Check(WorkspaceCreateInputSchema, {
      id: 'workspace-news',
      organizationId: 'org-a',
      slug: 'news',
      name: 'News',
      isDefault: true,
    })).toBe(true)
    expect(Value.Check(WorkspaceUpdateInputSchema, {
      organizationId: 'org-a',
      workspaceId: 'workspace-news',
    })).toBe(false)
    expect(Value.Check(WorkspaceArchiveInputSchema, {
      organizationId: 'org-a',
      workspaceId: 'workspace-news',
    })).toBe(true)
    expect(Value.Check(WorkspaceRestoreInputSchema, {
      organizationId: 'org-a',
      workspaceId: 'workspace-news',
    })).toBe(true)

    const overrideBase = {
      organizationId: 'org-a',
      workspaceId: 'workspace-news',
      userId: 'user-editor',
    }
    expect(Value.Check(WorkspaceMembershipOverrideInputSchema, {
      ...overrideBase,
      access: 'grant',
      role: 'editor',
    })).toBe(true)
    expect(Value.Check(WorkspaceMembershipOverrideInputSchema, {
      ...overrideBase,
      access: 'deny',
      role: 'editor',
    })).toBe(false)
    expect(Value.Check(WorkspaceMembershipOverrideInputSchema, {
      ...overrideBase,
      access: 'grant',
      role: null,
    })).toBe(false)

    expect(Value.Check(WorkspaceRecordSchema, {
      id: 'workspace-news',
      organizationId: 'org-a',
      slug: 'news',
      name: 'News',
      status: 'active',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })).toBe(true)
    expect(Value.Check(WorkspaceMembershipOverrideRecordSchema, {
      workspaceId: 'workspace-news',
      userId: 'user-editor',
      access: 'inherit',
      role: null,
      createdAt: now,
      updatedAt: now,
    })).toBe(true)
  })
})
