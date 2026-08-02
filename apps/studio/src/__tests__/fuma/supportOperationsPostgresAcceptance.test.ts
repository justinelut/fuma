import { createPostgresClient } from '../../../server/db/postgres'
import { supportOperationsAuthorityMigration } from '../../../server/fuma/db/migrations/000076_support_operations_authority'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations, runnableHostedMigrations } from '../../../server/fuma/db/migrations'
import { assertHostedMigrationIsAdditive, assertHostedMigrationManifest, hostedMigrationChecksum, nextHostedMigrationId } from '../../../server/fuma/db/migrationPolicy'
import { PostgresFumaSiteAuthorizationAuthority } from '../../../server/fuma/context'
import { PostgresSupportOperationsRepository, PostgresSupportRouteAuthorizationAuthority, type BreakGlassApprovalRecord, type BreakGlassExecutionRecord, type BreakGlassRequestRecord, type ModerationEvidenceRecord, type SupportOperationEffectRecord, type SupportSessionRecord, type SupportTenantScope } from '../../../server/fuma/supportOperations'

const CHECKSUM = 'bafa690ed6e28b161036b235d55c098534e61af929c31824f35a6541ae5ce60e'
const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-08-01T10:00:00.000Z'
const scope: SupportTenantScope = Object.freeze({ platformId: 'platform-pg', organizationId: 'organization-pg', workspaceId: 'workspace-pg', siteId: 'site-pg', ownerKey: 'owner-pg', ownerGeneration: 3 })
const evidence = (key: string) => ({ objectKey: `support/evidence/${key}.json`, hashSha256: 'a'.repeat(64) })
function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }
function support(id = 'support-pg'): SupportSessionRecord { return { supportSessionId: id, scope, staffActorId: 'staff-pg', staffSessionId: 'session-pg', targetUserId: 'customer-pg', reason: 'Investigate verified customer incident.', stepUpAt: '2026-08-01T09:59:00.000Z', startedAt: NOW, expiresAt: '2026-08-01T10:15:00.000Z', banner: 'Support session active — actions are performed as this account and are audited.', evidence: evidence(id) } }
function moderation(input: Readonly<{ id: string; prior: string | null; event: ModerationEvidenceRecord['event'] }>): ModerationEvidenceRecord { return { evidenceId: input.id, caseId: 'case-pg', priorEvidenceId: input.prior, scope, subject: { kind: 'site', id: scope.siteId }, event: input.event, reasonCode: 'verified-abuse', reason: `Verified moderation ${input.event} evidence for acceptance.`, evidence: evidence(input.id), actorId: 'moderator-pg', createdAt: new Date(Date.parse(NOW) + ['opened','suspended','appealed','resolved'].indexOf(input.event) * 1000).toISOString() } }

 describe('FUMA-072 migration 000076', () => {
  test('remains checksum-finalized, additive, and immediately precedes 000077', () => {
    expect(hostedMigrations.at(-2)).toBe(supportOperationsAuthorityMigration)
    expect(runnableHostedMigrations.at(-2)).toBe(supportOperationsAuthorityMigration)
    expect(HOSTED_MIGRATION_CHECKSUMS[supportOperationsAuthorityMigration.id]).toBe(CHECKSUM)
    expect(hostedMigrationChecksum(supportOperationsAuthorityMigration.sql)).toBe(CHECKSUM)
    expect(hostedMigrations[hostedMigrations.indexOf(supportOperationsAuthorityMigration) + 1]?.id).toBe('000077_public_handoff_authority')
    expect(() => assertHostedMigrationIsAdditive(supportOperationsAuthorityMigration)).not.toThrow()
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
  })

  test('declares append-only evidence and bounded support/recovery constraints', () => {
    const sql = supportOperationsAuthorityMigration.sql.toLowerCase().replaceAll(/\s+/g, ' ')
    expect(sql).toContain("expires_at <= created_at + interval '30 minutes'")
    expect(sql).toContain("expires_at <= created_at + interval '15 minutes'")
    expect(sql).toContain('unique(request_id,approver_id)')
    expect(sql).toContain('unique(kind,operation_id)')
    expect(sql.match(/execute function fuma_support_operations_reject_mutation\(\)/g)).toHaveLength(16)
  })
})

describe('FUMA-072 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes active support, moderation, approvals, effects, and rejects evidence mutation', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_support_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(supportOperationsAuthorityMigration.sql)
      const repository = new PostgresSupportOperationsRepository(db)
      const sessions = await Promise.all(Array.from({ length: 8 }, () => repository.insertSupportSession(support())))
      expect(sessions.filter(Boolean)).toHaveLength(1)
      expect(await repository.findActiveSupportSession(scope, 'staff-pg', 'customer-pg', '2026-08-01T10:01:00.000Z')).toEqual(support())
      expect(await repository.insertSupportSession({ ...support('support-other'), targetUserId: 'customer-other' })).toBe(false)
      expect(await repository.insertSupportSessionEnd({ supportSessionId: 'support-pg', endedByActorId: 'staff-pg', reasonCode: 'completed', endedAt: '2026-08-01T10:02:00.000Z' })).toBe(true)
      expect(await repository.insertSupportSession({ ...support('support-next'), startedAt: '2026-08-01T10:03:00.000Z', expiresAt: '2026-08-01T10:10:00.000Z' })).toBe(true)

      const opens = await Promise.all([
        repository.insertModerationEvidence(moderation({ id: 'open-a', prior: null, event: 'opened' })),
        repository.insertModerationEvidence(moderation({ id: 'open-b', prior: null, event: 'opened' })),
      ])
      expect(opens.filter(Boolean)).toHaveLength(1)
      const openId = opens[0] ? 'open-a' : 'open-b'
      expect(await repository.insertModerationEvidence(moderation({ id: 'suspended', prior: openId, event: 'suspended' }))).toBe(true)
      expect(await repository.insertModerationEvidence(moderation({ id: 'appealed', prior: 'suspended', event: 'appealed' }))).toBe(true)
      expect((await repository.listModerationQueue(scope, 'appeal', null, 10)).map((row) => row.evidenceId)).toEqual(['appealed'])
      expect(await repository.insertModerationEvidence(moderation({ id: 'invalid-branch', prior: 'suspended', event: 'resolved' }))).toBe(false)
      expect(await repository.insertModerationEvidence(moderation({ id: 'resolved', prior: 'appealed', event: 'resolved' }))).toBe(true)
      expect(await repository.latestModerationEvidence({ ...scope, ownerGeneration: 4 }, 'site', scope.siteId)).toBeNull()
      expect(await repository.findActiveSupportSession({ ...scope, siteId: 'site-other' }, 'staff-pg', 'customer-pg', '2026-08-01T10:04:00.000Z')).toBeNull()
      expect(await repository.insertSupportAction({ supportSessionId: 'support-next', operationId: 'action-pg', capability: 'site.read', inputHashSha256: 'b'.repeat(64), actorId: 'customer-pg', createdAt: '2026-08-01T10:04:00.000Z' })).toBe(true)

      const request: BreakGlassRequestRecord = { requestId: 'recovery-pg', scope, targetOwnerId: 'owner-user-pg', requestedByActorId: 'requester-pg', reason: 'Recover protected owner after verified lockout evidence.', evidence: evidence('recovery'), channel: 'isolated-owner-recovery', createdAt: NOW, expiresAt: '2026-08-01T10:10:00.000Z' }
      expect(await repository.insertBreakGlassRequest(request)).toBe(true)
      const approval = (id: string, actor: string): BreakGlassApprovalRecord => ({ approvalId: id, requestId: request.requestId, approverId: actor, approverSessionId: `session-${actor}`, stepUpAt: '2026-08-01T09:59:00.000Z', evidence: evidence(id), approvedAt: '2026-08-01T10:01:00.000Z' })
      const approvals = await Promise.all([repository.insertBreakGlassApproval(approval('approval-a', 'approver-a')), repository.insertBreakGlassApproval(approval('approval-b', 'approver-b')), repository.insertBreakGlassApproval(approval('approval-c', 'approver-c'))])
      expect(approvals.filter(Boolean)).toHaveLength(2)
      const execution = (id: string): BreakGlassExecutionRecord => ({ executionId: id, requestId: request.requestId, executorId: 'executor-pg', approverIds: ['approver-a', 'approver-b'], recoveryIdempotencyKey: 'recovery-effect-pg', executedAt: '2026-08-01T10:02:00.000Z' })
      const executions = await Promise.all([repository.insertBreakGlassExecution(execution('execution-a')), repository.insertBreakGlassExecution(execution('execution-b'))])
      expect(executions.filter(Boolean)).toHaveLength(1)

      let effects = 0
      const effect: SupportOperationEffectRecord = { effectKey: 'moderation-applied:appealed', kind: 'moderation-applied', operationId: 'appealed', completedAt: '2026-08-01T10:02:00.000Z' }
      const effectResults = await Promise.all(Array.from({ length: 8 }, () => repository.runEffect(effect, async () => { effects += 1 })))
      expect(effectResults.filter(Boolean)).toHaveLength(1)
      expect(effects).toBe(1)

      const immutableTables = ['fuma_support_sessions_v2', 'fuma_support_session_ends_v2', 'fuma_support_actions_v2', 'fuma_moderation_evidence_v2', 'fuma_break_glass_requests_v2', 'fuma_break_glass_approvals_v2', 'fuma_break_glass_executions_v2', 'fuma_support_operation_effects_v2'] as const
      for (const table of immutableTables) {
        await expect(db.unsafe(`update ${table} set record_json=record_json`)).rejects.toThrow('append-only')
        await expect(db.unsafe(`delete from ${table}`)).rejects.toThrow('append-only')
      }
      const counts = await db<{ sessions: string; moderation: string; approvals: string; executions: string; effects: string }>`select (select count(*) from fuma_support_sessions_v2)::text sessions,(select count(*) from fuma_moderation_evidence_v2)::text moderation,(select count(*) from fuma_break_glass_approvals_v2)::text approvals,(select count(*) from fuma_break_glass_executions_v2)::text executions,(select count(*) from fuma_support_operation_effects_v2)::text effects`
      expect(counts.rows[0]).toEqual({ sessions: '2', moderation: '4', approvals: '2', executions: '1', effects: '1' })
      process.stdout.write('[FUMA-072 PostgreSQL demo] concurrent=8 sessions=2 moderation=4 approvals=2 executions=1 effects=1 immutable=16/16 isolated=true\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)

  test.skipIf(!postgresUrl)('overlays site.read only for current non-owner support staff and bounded impersonation sessions', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_support_route_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table auth_users(id text primary key,email text not null,role text,banned boolean,ban_expires timestamptz);
        create table auth_sessions(id text primary key,user_id text not null,impersonated_by text,created_at timestamptz not null,expires_at timestamptz not null);
        create table auth_staff_profiles(user_id text primary key);
        create table auth_members(id text primary key,organization_id text not null,user_id text not null,role text not null);
        create table fuma_organization_profiles(organization_id text primary key,kind text not null,status text not null);
        create table fuma_workspaces(organization_id text not null,id text not null,status text not null,primary key(organization_id,id));
        create table fuma_sites(organization_id text not null,workspace_id text not null,id text not null,status text not null,profile_id text not null,capability_overrides_json jsonb not null,primary key(organization_id,workspace_id,id));
        create table fuma_tenant_owner_keys(platform_id text not null,organization_id text not null,workspace_id text not null,site_id text not null,state text not null);
        create table fuma_workspace_membership_overrides(workspace_id text not null,user_id text not null,access text not null,role text);
        insert into auth_users values
          ('staff-route','staff@trimly.co.ke','admin',false,null),
          ('owner-route','owner@trimly.co.ke','admin',false,null),
          ('customer-route','customer@example.com','user',false,null);
        insert into auth_staff_profiles values ('staff-route'),('owner-route');
        insert into auth_sessions values
          ('session-staff-route','staff-route',null,'2026-08-01T09:59:00Z','2026-08-01T10:30:00Z'),
          ('session-owner-route','owner-route',null,'2026-08-01T09:59:00Z','2026-08-01T10:30:00Z'),
          ('session-impersonated-route','customer-route','staff-route','2026-08-01T10:00:00Z','2026-08-01T10:15:00Z'),
          ('session-expired-route','customer-route','staff-route','2026-08-01T09:00:00Z','2026-08-01T09:30:00Z');
        insert into fuma_organization_profiles values ('organization-route','customer','active');
        insert into fuma_workspaces values ('organization-route','workspace-route','active');
        insert into fuma_sites values ('organization-route','workspace-route','site-route','active','website','{"grant":[],"revoke":[]}'::jsonb);
        insert into fuma_tenant_owner_keys values ('platform-route','organization-route','workspace-route','site-route','active');
      `)
      const routeScope = { organizationId: 'organization-route', workspaceId: 'workspace-route', siteId: 'site-route' }
      const canonical = new PostgresFumaSiteAuthorizationAuthority(db)
      const overlay = new PostgresSupportRouteAuthorizationAuthority({ db, protectedOwnerEmail: 'owner@trimly.co.ke', sites: canonical, now: () => new Date(NOW) })
      const staffActor = { kind: 'staff' as const, userId: 'staff-route', sessionId: 'session-staff-route', impersonator: null }
      const ordinary = await canonical.loadExactSiteAuthorization({ actor: staffActor, routeScope }) as { permissions: { roleAssignments: unknown[] } }
      expect(ordinary.permissions.roleAssignments).toHaveLength(0)
      const internal = await overlay.loadExactSiteAuthorization({ actor: staffActor, routeScope }) as { permissions: { roleAssignments: { id: string }[] } }
      expect(internal.permissions.roleAssignments).toHaveLength(1)
      expect(internal.permissions.roleAssignments[0]!.id).toStartWith('support-route-')
      expect(await overlay.loadExactSiteAuthorization({ actor: { ...staffActor, userId: 'owner-route', sessionId: 'session-owner-route' }, routeScope })).toBeNull()
      const impersonated = await overlay.loadExactSiteAuthorization({ actor: { kind: 'staff', userId: 'customer-route', sessionId: 'session-impersonated-route', impersonator: { userId: 'staff-route' } }, routeScope }) as { permissions: { roleAssignments: unknown[] } }
      expect(impersonated.permissions.roleAssignments).toHaveLength(1)
      expect(await overlay.loadExactSiteAuthorization({ actor: { kind: 'staff', userId: 'customer-route', sessionId: 'session-expired-route', impersonator: { userId: 'staff-route' } }, routeScope })).toBeNull()
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
