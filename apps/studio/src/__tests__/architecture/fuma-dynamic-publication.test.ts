import { describe, expect, test } from 'bun:test'
import { assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import { dynamicPublicationTemplatesMigration } from '../../../server/fuma/db/migrations/000050_dynamic_publication_templates'
import { hostedMigrations } from '../../../server/fuma/db/migrations'

const root = new URL('../../../', import.meta.url)
async function read(path: string): Promise<string> { return Bun.file(new URL(path, root)).text() }

describe('FUMA-037 Dynamic Publication architecture', () => {
  test('keeps the centrally registered migration additive and immutable', () => {
    expect(dynamicPublicationTemplatesMigration.id).toBe('000050_dynamic_publication_templates')
    expect(() => assertHostedMigrationIsAdditive(dynamicPublicationTemplatesMigration)).not.toThrow()
    expect(hostedMigrations).toContain(dynamicPublicationTemplatesMigration)
    expect(dynamicPublicationTemplatesMigration.sql).not.toMatch(/drop\s|truncate\s|delete\s+from|alter\s/i)
  })
  test('uses strict TypeBox boundaries and no Zod or caller tenant authority', async () => {
    const contracts = await read('src/core/fuma/publication/dynamicPublication.ts')
    const routes = await read('server/fuma/publication/dynamicPublicationRoutes.ts')
    expect(`${contracts}\n${routes}`).toContain('additionalProperties: false')
    expect(`${contracts}\n${routes}`).toContain('safeParseValue')
    expect(`${contracts}\n${routes}`).not.toMatch(/from ['"]zod|z\.(object|string|array)/)
    expect(routes).not.toMatch(/searchParams\.get\(['"](?:ownerKey|organizationId|workspaceId|siteId|profileId)/)
  })
  test('qualifies every archive read by exact authority and batches relations in one bounded statement', async () => {
    const repository = await read('server/fuma/publication/dynamicPublicationRepository.ts')
    for (const qualifier of ['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) expect(repository).toContain(qualifier)
    for (const guard of ["owner.state='active'",'owner.transfer_id is null','owner.transfer_lock_id is null','owner.transfer_fence is null']) expect(repository).toContain(guard)
    expect(repository).toContain("jsonField('cells_json', 'publicationId', db.dialect).sql")
    expect(repository).toContain('return placeholder(db.dialect, params.length)')
    expect(repository).toContain('limit ${bind(query.pageSize)} offset ${bind(offset)}')
    expect(repository).toContain('db.unsafe<LoopEnvelopeRow>(sql, params)')
    expect(repository).toContain('relations as (')
    expect(repository).toContain("jsonb_agg(relation.target_id order by relation.position)")
    expect(repository).toContain('from fuma_publication_member_access member_access')
    expect(repository).toContain("member_access.resource_kind='post'")
    expect(repository).toContain("member_access.resource_kind='tag'")
    const queryMethod = repository.slice(repository.indexOf('async queryLoop('))
    expect(queryMethod).not.toMatch(/for\s*\([^)]*(?:items|rows)|\.map\([^)]*=>\s*(?:db|this\.#db)/)
  })
  test('exposes additive central composition and public host-authority seams without importing another app', async () => {
    const composition = await read('server/fuma/publication/dynamicPublicationComposition.ts')
    const central = await read('server/fuma/publication/composition.ts')
    const freeHost = await read('server/fuma/freeHosts/publicRouter.ts')
    const routeContent = await read('src/admin/fuma/publication/PublicationRouteContent.tsx')
    const workspace = await read('src/admin/fuma/publication/PublicationWorkspace.tsx')
    const routes = await read('server/fuma/publication/dynamicPublicationRoutes.ts')
    const editor = await read('src/admin/fuma/publication/DynamicPublicationTemplateEditor.tsx')
    expect(composition).toContain('createDynamicPublicationComposition')
    expect(composition).toContain('scopedRoutes: createDynamicPublicationScopedRouteDeclarations(service)')
    expect(central).toContain('...dynamicPublication.scopedRoutes')
    expect(freeHost).toContain('FreeHostRouteExtension')
    expect(routeContent).toContain("'route.design'")
    expect(workspace).toContain('<DynamicPublicationTemplateEditor')
    expect(routes).toContain('createDynamicPublicationScopedRouteDeclarations')
    expect(routes).toContain('DynamicPublicationPublicBoundary')
    expect(routes).toContain('scopeForHost')
    expect(editor).toContain("@ui/components/Button")
    expect(editor).toContain("./DynamicPublicationTemplateEditor.module.css")
    expect(`${routes}\n${editor}`).not.toMatch(/apps\/(?:web|control-surfaces)|tailwind|@fuma\/ui/)
  })
})
