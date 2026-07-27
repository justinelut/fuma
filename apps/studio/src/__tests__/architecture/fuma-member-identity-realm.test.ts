import { describe,expect,it } from 'bun:test'
import { hostedMigrationChecksum,assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import { memberIdentityRealmMigration } from '../../../server/fuma/db/migrations/000042_member_identity_realm'
import { hostedMigrations,HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'

const root=new URL('../../../',import.meta.url)
async function read(path:string){return await Bun.file(new URL(path,root)).text()}

describe('FUMA-038 member identity architecture',()=>{
 it('reserves additive hosted migration 000042 after preserving concurrent registry entries',()=>{
  expect(memberIdentityRealmMigration.id).toBe('000042_member_identity_realm')
  expect(()=>assertHostedMigrationIsAdditive(memberIdentityRealmMigration)).not.toThrow()
  expect(hostedMigrations).toContain(memberIdentityRealmMigration)
  expect(hostedMigrations.findIndex(({id})=>id===memberIdentityRealmMigration.id)).toBeLessThan(hostedMigrations.findIndex(({id})=>id==='000043_free_host_authority'))
  expect(HOSTED_MIGRATION_CHECKSUMS[memberIdentityRealmMigration.id]).toBe(hostedMigrationChecksum(memberIdentityRealmMigration.sql))
  const checksum=hostedMigrationChecksum(memberIdentityRealmMigration.sql)
  process.stdout.write(`[FUMA-038 migration] ${memberIdentityRealmMigration.id} sha256=${checksum}\n`)
  expect(checksum).toMatch(/^[a-f0-9]{64}$/)
 })
 it('stores no raw session tokens and scopes every durable realm table to full ancestry, generation, and profile',()=>{
  const sql=memberIdentityRealmMigration.sql
  for(const table of ['fuma_member_identities','fuma_member_sessions','fuma_member_consent_events','fuma_member_import_receipts'])expect(sql).toContain(`create table ${table}`)
  for(const coordinate of ['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id'])expect((sql.match(new RegExp(coordinate,'g'))??[]).length).toBeGreaterThanOrEqual(4)
  expect(sql).toContain('token_hash_sha256');expect(sql).not.toMatch(/\btoken\s+text|session_token|refresh_token|access_token/i)
  expect(sql).toContain('append-only');expect(sql).toContain("origin='staff-import'");expect(sql).toContain('password_hash is null')
 })
 it('keeps strict TypeBox-only contracts and rejects authority or staff role fields at member boundaries',async()=>{
  const contracts=await read('server/fuma/memberIdentity/contracts.ts'),boundary=await read('server/fuma/memberIdentity/boundary.ts'),imports=await read('server/fuma/memberIdentity/importService.ts'),importBoundary=await read('server/fuma/memberIdentity/importBoundary.ts')
  expect(`${contracts}\n${boundary}\n${imports}\n${importBoundary}`).not.toMatch(/from ['"]zod|z\.(object|string|array)/)
  expect((contracts.match(/additionalProperties: false/g)??[]).length).toBeGreaterThanOrEqual(12)
  for(const forbidden of ['staffRoles: Type.Array','role: Type.','ownerKey: Type.','sessionToken: Type.','passwordHash: MemberImport'])expect(contracts).not.toContain(forbidden)
  expect(imports).toContain('samePublicationScope');expect(contracts).toContain("purpose: Type.Literal('member-import')")
  expect(importBoundary).toContain("'publication.members.write'")
  expect(importBoundary).toContain('resolveStaffSession')
  expect(importBoundary).toContain('impersonatedBy !== null')
 })
 it('mounts dedicated member namespaces before public/CMS routes and never enters Better Auth',async()=>{
  const router=await read('server/router.ts'),server=await read('server/index.ts'),runtime=await read('server/fuma/memberIdentity/runtime.ts')
  expect(router).toContain('tryServeMemberAuth');expect(router.indexOf('tryServeMemberAuth')).toBeLessThan(router.indexOf('tryServeCmsApi'))
  expect(router).toContain('tryServeMemberImports');expect(router.indexOf('tryServeMemberImports')).toBeLessThan(router.indexOf('tryServeFumaScopedApi'))
  expect(server).toContain('memberAuth: memberIdentityRuntime?.boundary')
  expect(server).toContain('memberImports: memberImportBoundary')
  expect(runtime).toContain('FUMA_MEMBER_AUTH_SECRET');expect(runtime).toContain('must not equal the Better Auth staff secret')
  expect(`${router}\n${runtime}`).not.toMatch(/memberAuth.*hostedStaffAuth|createHostedAuth\(/)
 })
 it('enforces current trusted host authority and exact scope in every PostgreSQL operation',async()=>{
  const authority=await read('server/fuma/memberIdentity/postgresAuthority.ts'),repository=await read('server/fuma/memberIdentity/postgresRepository.ts')
  for(const token of ["owner.state='active'",'transfer_id is null','transfer_lock_id is null','transfer_fence is null',"site.status='active'","domain.certificate='active'","free.state='active'"])expect(authority).toContain(token)
  for(const coordinate of ['platformId','organizationId','workspaceId','siteId','ownerKey','generation','profileId'])expect(repository).toContain(`scope.${coordinate}`)
  expect(repository).toContain("state='active'");expect(repository).toContain('for share')
 })
})
