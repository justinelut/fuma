import { describe, expect, test } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { memberAccountsAccessMigration } from '../../../server/fuma/db/migrations/000047_member_accounts_access'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { PostgresPublicationMemberAccessRepository } from '../../../server/fuma/publication/memberAccessPostgres'
import { createPublicationScopedRouteDeclarations } from '../../../server/fuma/publication/routes'
import { PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

function recordingDb() {
  const sql: string[] = []
  const callable = async <Row>(strings: TemplateStringsArray): Promise<DbResult<Row>> => {
    const text = strings.join('?')
    sql.push(text)
    if (text.includes('from fuma_tenant_owner_keys')) return { rows: [{ authorized: 1 } as Row], rowCount: 1 }
    if (text.includes('from fuma_publication_segment_memberships') && text.includes('select segment_id,member_id')) return { rows: [{ segment_id: 'segment-1', member_id: 'member-1', segment_version: 2, calculated_at: TEST_NOW } as Row], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }
  const db = Object.assign(callable, {
    dialect: 'postgres' as const,
    unsafe: async <Row>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 }),
    transaction: async <T>(work: (transaction: DbClient) => Promise<T>) => await work(db as DbClient),
  }) as DbClient
  return { db, sql }
}

const account = { accountId: 'account-1', memberIdentityId: 'identity-1', memberId: 'member-1', displayName: 'Member', locale: 'en-KE', timezone: 'Africa/Nairobi', state: 'deleted' as const, createdAt: '2040-01-01T00:00:00.000Z', updatedAt: TEST_NOW, deletedAt: TEST_NOW }
const deletion = { requestId: 'delete-1', accountId: 'account-1', memberId: 'member-1', kind: 'deletion' as const, state: 'completed' as const, requestedBy: 'staff' as const, reason: 'Verified', createdAt: '2040-01-01T00:00:00.000Z', completedAt: TEST_NOW }

describe('FUMA-039 PostgreSQL and architecture gates', () => {
  test('migration binds accounts to the exact FUMA-038 realm and exact member pair', () => {
    const sql = memberAccountsAccessMigration.sql
    expect(memberAccountsAccessMigration.id).toBe('000047_member_accounts_access')
    expect(() => assertHostedMigrationIsAdditive(memberAccountsAccessMigration)).not.toThrow()
    expect(hostedMigrationChecksum(sql)).toMatch(/^[a-f0-9]{64}$/)
    expect(sql).toContain('references fuma_member_identities(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)')
    expect(sql).toContain('references fuma_publication_members(platform_id, owner_key, owner_generation, profile_id, member_id)')
    expect(sql.match(/references fuma_publication_member_accounts\(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, account_id, member_id\)/g)?.length).toBe(2)
    expect(sql).toContain("jsonb_typeof(rules_json)='array'")
    expect(sql).toContain("source in ('staff-import','one-click')")
    expect(sql).toContain("state<>'grace' or grace_ends_at is not null")
    expect(sql).toContain('publication member consent provenance is append-only')
  })

  test('member snapshot query returns only the requested subject and remains fully scoped', async () => {
    const h = recordingDb()
    const repository = new PostgresPublicationMemberAccessRepository(h.db)
    expect(await repository.listMemberSegmentSnapshots(PUBLICATION_TEST_SCOPE, 'member-1', 20)).toEqual([{ segmentId: 'segment-1', segmentVersion: 2, memberIds: ['member-1'], calculatedAt: TEST_NOW }])
    const text = h.sql.join('\n')
    expect(text).toContain('member_id=?')
    expect(text).toContain('limit ?')
    expect(text).not.toContain('array_agg(member_id')
    for (const qualifier of ['platform_id=', 'organization_id=', 'workspace_id=', 'site_id=', 'owner_key=', 'owner_generation=', 'profile_id=']) expect(text).toContain(qualifier)
  })

  test('deletion query revokes realm sessions and erases credentials without violating FUMA-038 origin constraints', async () => {
    const h = recordingDb()
    const repository = new PostgresPublicationMemberAccessRepository(h.db)
    expect(await repository.completeDeletion(PUBLICATION_TEST_SCOPE, deletion, account)).toBe(true)
    const text = h.sql.join('\n')
    expect(text).toContain('update fuma_member_sessions set revoked_at=')
    expect(text).toContain("password_hash=case when origin='self-signup'")
    expect(text).toContain("state=case when origin='staff-import' then 'activation-required' else 'disabled' end")
    expect(text).toContain("attributes_json=")
    expect(text).toContain("set state='revoked'")
  })

  test('declares bounded member routes under exact permissions and composes one production authority', async () => {
    const declarations = createPublicationScopedRouteDeclarations({} as never)
    const permissions = new Map(declarations.map((route) => [`${route.method} ${route.path}`, route.permission]))
    expect(permissions.get('GET /publication/member-accounts')).toBe('publication.members.read')
    expect(permissions.get('POST /publication/member-accounts')).toBe('publication.members.write')
    expect(permissions.get('POST /publication/member-access/evaluate')).toBe('publication.members.read')
    expect(permissions.get('POST /publication/member-privacy/export')).toBe('publication.members.read')
    expect(permissions.get('POST /publication/member-privacy/deletion/complete')).toBe('publication.members.write')
    const routes = await Bun.file(new URL('../../../server/fuma/publication/routes.ts', import.meta.url)).text()
    const composition = await Bun.file(new URL('../../../server/fuma/publication/composition.ts', import.meta.url)).text()
    expect(routes).toContain('maximum: 200')
    expect(routes).toContain("await ports.memberAccess.export(scoped(input),command.accountId,'staff')")
    expect(composition).toContain('new PostgresPublicationMemberAccessRepository(input.db)')
    expect(composition).toContain('memberAccess,analytics:')
  })

  test('Studio account UI uses CSS Modules and current accessible form primitives', async () => {
    const source = await Bun.file(new URL('../../admin/fuma/publication/MemberAccessSurface.tsx', import.meta.url)).text()
    expect(source).toContain("from './MemberAccessSurface.module.css'")
    for (const primitive of ["@ui/components/Button", "@ui/components/FormField", "@ui/components/Input", "@ui/components/Select"]) expect(source).toContain(primitive)
    expect(source).toContain('aria-labelledby="member-profile-title"')
    expect(source).toContain('<caption>')
    expect(source).not.toContain('style={{')
  })
})
