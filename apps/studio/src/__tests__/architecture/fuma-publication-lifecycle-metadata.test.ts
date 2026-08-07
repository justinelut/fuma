import { assertHostedMigrationIsAdditive, hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { publicationLifecycleMetadataMigration } from '../../../server/fuma/db/migrations/000044_publication_lifecycle_metadata'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations } from '../../../server/fuma/db/migrations'

const root = new URL('../../../', import.meta.url)
async function read(path: string) { return Bun.file(new URL(path, root)).text() }

describe('FUMA-034 lifecycle and metadata architecture', () => {
  test('reserves only additive hosted migration 000044 after the finalized concurrent registry prefix', () => {
    const ids = hostedMigrations.map(({ id }) => id)
    const index = ids.indexOf('000044_publication_lifecycle_metadata')
    expect(ids[index - 1]).toBe('000043_free_host_authority')
    expect(ids[index]).toBe('000044_publication_lifecycle_metadata')
    expect(() => assertHostedMigrationIsAdditive(publicationLifecycleMetadataMigration)).not.toThrow()
    expect(hostedMigrationChecksum(publicationLifecycleMetadataMigration.sql)).toBe(HOSTED_MIGRATION_CHECKSUMS[publicationLifecycleMetadataMigration.id])
    expect(HOSTED_MIGRATION_CHECKSUMS['000040_publication_universal_content']).toBe('002244022f0c0a799cf0a2e8b3601736225ef97fd03cef6c3c6dc2112161d233')
    expect(HOSTED_MIGRATION_CHECKSUMS['000041_publication_revisions']).toBe('7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc')
    expect(HOSTED_MIGRATION_CHECKSUMS['000042_member_identity_realm']).toBe('638536b3172e3242741e8d587a0ef35f0d86012629f29bf89584913fa12208e0')
    expect(HOSTED_MIGRATION_CHECKSUMS['000043_free_host_authority']).toBe('d41fda99a82a0e260d386c3feababfda65cb67b4972f88a24c33f3e555bb375b')
  })

  test('keeps strict TypeBox-only lifecycle, social, redirect, visibility, and decision contracts', async () => {
    const contracts = await read('src/core/fuma/publication/contracts.ts')
    for (const schema of ['PublicationRedirectSchema', 'PublicationOpenGraphSchema', 'PublicationSocialMetadataSchema', 'PublicationVisibilitySchema', 'PublicationPresentationRequestSchema', 'PublicationPresentationDecisionSchema']) expect(contracts).toContain(schema)
    expect(contracts).toContain("Type.Literal('unpublished')")
    expect(contracts).toContain('additionalProperties: false')
    expect(contracts).not.toMatch(/from ['"]zod|z\.(object|string|array)/)
  })

  test('binds mutable authority, redirects, revisions, and transitions to exact ancestry/generation/profile', async () => {
    const migration = await read('server/fuma/db/migrations/000044_publication_lifecycle_metadata.ts')
    const store = await read('server/fuma/publication/universalContentStore.ts')
    for (const table of ['fuma_publication_metadata_authority', 'fuma_publication_redirect_authority', 'fuma_publication_authority_revisions', 'fuma_publication_lifecycle_transitions']) expect(migration).toContain(table)
    for (const qualifier of ['platform_id', 'organization_id', 'workspace_id', 'site_id', 'owner_key', 'owner_generation', 'profile_id']) { expect(migration).toContain(qualifier); expect(store).toContain(qualifier) }
    for (const fence of ['owner.generation=${scope.generation}', "owner.state='active'", 'owner.transfer_id is null', 'owner.transfer_lock_id is null', 'owner.transfer_fence is null', 'site.profile_id=${scope.profileId}']) expect(store).toContain(fence)
    expect(store).toContain('pg_advisory_xact_lock')
    expect(store).toContain('fuma_publication_authority_revisions')
    expect(migration).toContain('fuma_publication_authority_revisions_immutable')
    expect(migration).not.toMatch(/drop table|drop column|truncate|alter\s+table[\s\S]{0,100}(?:drop|rename)/i)
  })

  test('derives route scope and actor while exposing only semantic audience context', async () => {
    const routes = await read('server/fuma/publication/routes.ts')
    expect(routes).toContain("'/publication/content/:contentId/presentation'")
    expect(routes).toContain("'publication.posts.read'")
    expect(routes).toContain('decidePublicationPresentation(value')
    const presentation = routes.slice(routes.indexOf("'/publication/content/:contentId/presentation'"), routes.indexOf("'/publication/content'", routes.indexOf("'/publication/content/:contentId/presentation'") + 10))
    for (const forbidden of ['ownerKey', 'organizationId', 'workspaceId', 'siteId', 'profileId', 'actorId', 'sessionId']) expect(presentation).not.toContain(`${forbidden}: Type.`)
  })

  test('keeps Studio panels in the existing CSS Module and renders safe preview in a sandbox without raw HTML injection', async () => {
    const workspace = await read('src/admin/fuma/publication/PublicationWorkspace.tsx')
    for (const label of ['SEO, social, and access', 'Publication lifecycle', 'Semantic preview and access decision', 'Publication presentation decision', 'Safe semantic publication preview']) expect(workspace).toContain(label)
    expect(workspace).toContain('sandbox=""')
    expect(workspace).not.toContain('dangerouslySetInnerHTML')
    expect(workspace).not.toContain('module.css')
    // The three labelled sub-panels and the focusable decision region are the properties; they are
    // asserted on the view now that the rules live there as utilities.
    for (const label of ['publication-metadata-title', 'Publication lifecycle', 'publication-preview-title'])
      expect(workspace, label).toContain(label)
    expect(workspace).toContain('focus-visible:')
  })
})
