import { describe, expect, test } from 'bun:test'
import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { publicationRevisionsMigration } from '../../../server/fuma/db/migrations/000041_publication_revisions'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations } from '../../../server/fuma/db/migrations'

const root=new URL('../../../',import.meta.url)
async function read(path:string){return Bun.file(new URL(path,root)).text()}

describe('FUMA-031 revision architecture',()=>{
  test('reserves finalized additive hosted migration 000041 without changing the prior registry prefix',()=>{
    const ids=hostedMigrations.map(migration=>migration.id);const index=ids.indexOf('000041_publication_revisions')
    expect(ids[index-1]).toBe('000040_publication_universal_content')
    expect(ids[index+1]).toBe('000042_member_identity_realm')
    expect(()=>assertHostedMigrationIsAdditive(publicationRevisionsMigration)).not.toThrow()
    expect(hostedMigrationChecksum(publicationRevisionsMigration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[publicationRevisionsMigration.id])
  })
  test('keeps revisions/audit immutable and makes snapshot references the sole GC reachability authority',async()=>{
    const migration=await read('server/fuma/db/migrations/000041_publication_revisions.ts')
    const repository=await read('server/fuma/publication/revisions.ts')
    expect(migration).toContain('fuma_publication_revision_entries_immutable')
    expect(migration).toContain('fuma_publication_revision_audit_immutable')
    expect(repository).toContain("action:'revision-restored'")
    expect(repository).toContain('document_json=${JSON.stringify(document)}::text::jsonb')
    expect(repository).toContain("details_json,created_at) values")
    expect(repository).toContain("JSON.stringify({action:input.action})}::text::jsonb")
    expect(repository).toContain('not exists (select 1 from fuma_publication_revision_snapshot_refs')
    expect(repository).toContain("snapshot.state='available'")
    expect(repository).toContain("set state='deleting'")
  })
  test('reloads current owner generation and assigned profile inside every repository transaction',async()=>{
    const repository=await read('server/fuma/publication/revisions.ts')
    for(const token of ['owner.platform_id=${scope.platformId}','owner.generation=${scope.generation}','site.profile_id=${scope.profileId}',"owner.state='active'",'owner.transfer_id is null','owner.transfer_lock_id is null','owner.transfer_fence is null','for share'])expect(repository).toContain(token)
    for(const qualifier of ['platform_id=${s.platformId}','organization_id=${s.organizationId}','workspace_id=${s.workspaceId}','site_id=${s.siteId}','owner_key=${s.ownerKey}','owner_generation=${s.generation}','profile_id=${s.profileId}'])expect(repository).toContain(qualifier)
  })
  test('uses strict TypeBox only and keeps job payloads free of tenant/profile/actor authority',async()=>{
    const contracts=await read('src/core/fuma/publication/contracts.ts');const handlers=await read('server/fuma/publication/jobHandlers.ts')
    for(const schema of ['PublicationRevisionRecordSchema','PublicationRevisionCreateCommandSchema','PublicationRevisionRestoreCommandSchema','PublicationRevisionComparisonSchema'])expect(contracts).toContain(schema)
    expect(`${contracts}\n${handlers}`).not.toMatch(/from ['"]zod|z\.(object|string|array)/)
    const periodic=handlers.slice(handlers.indexOf('RevisionPeriodicPayloadSchema'),handlers.indexOf('function site'))
    for(const forbidden of ['organizationId','workspaceId','siteId','ownerKey','profileId','actorId'])expect(periodic).not.toContain(forbidden)
    for(const job of ['publication.revision-periodic','publication.revision-retention','publication.revision-gc'])expect(handlers).toContain(job)
  })
  test('keeps Studio history in the current CSS Module/primitives and exposes labelled keyboard-accessible diff/restore controls',async()=>{
    const workspace=await read('src/admin/fuma/publication/PublicationWorkspace.tsx');const css=await read('src/admin/fuma/publication/PublicationWorkspace.module.css')
    expect(workspace).toContain("import { Button } from '@ui/components/Button'")
    expect(workspace).toContain("import styles from './PublicationWorkspace.module.css'")
    for(const token of ['aria-labelledby="revision-history-title"','aria-label="Revision differences"','tabIndex={0}','Review restore','Restore as new head','Existing revisions remain immutable'])expect(workspace).toContain(token)
    expect(css).toContain('.history{');expect(css).toContain('.diff:focus-visible')
    expect(workspace).not.toMatch(/window\.confirm|window\.alert/)
  })
})
