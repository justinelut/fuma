import { readFileSync } from 'node:fs'
const source = (path: string) => readFileSync(path, 'utf8')
describe('FUMA-073 expert discovery architecture', () => {
  it('mounts production routes and console metadata on existing 000037 without depending on protected 000078', () => {
    const runtime = source('apps/studio/server/fuma/expertDiscovery/runtime.ts'); const contracts = source('apps/studio/server/fuma/expertDiscovery/contracts.ts'); const composition = source('apps/studio/server/fuma/platformConsole/composition.ts'); const hosted = source('apps/studio/server/auth/hosted/runtime.ts')
    expect(runtime).toContain('createHostedExpertDiscoveryRuntime'); expect(contracts).toContain("mounted: true as const"); expect(contracts).toContain('000037_operations_experts_transfer'); expect(contracts).not.toContain('000078_next_source_portability_authority'); expect(composition).toContain('expertDiscoveryConsoleContribution'); expect(hosted).toContain('expertRoutes')
  })
  it('reuses canonical Better Auth, PostgreSQL 000037, FUMA-072 moderation, FUMA-068 review, FUMA-074 transfer and object storage', () => {
    const service = source('apps/studio/server/fuma/expertDiscovery/service.ts'); const postgres = source('apps/studio/server/fuma/expertDiscovery/postgres.ts'); const production = source('apps/studio/server/fuma/expertDiscovery/production.ts'); const vault = source('apps/studio/server/fuma/expertDiscovery/inquiryVault.ts'); const projections = source('apps/studio/server/fuma/publicProjections/registeredAuthorities.ts')
    expect(service).toContain("request.context.source.kind !== 'staff-session'"); expect(service).toContain('resolveDestination'); expect(postgres).toContain('fuma_expert_profiles'); expect(postgres).toContain('fuma_expert_inquiries'); expect(postgres).toContain('ExpertRepositoryConflict'); expect(production).toContain('auth_sessions'); expect(production).toContain('fuma_moderation_evidence_v2'); expect(production).toContain('fuma_artifact_review_decisions_v2'); expect(production).toContain('fuma_site_transfer_proposals'); expect(vault).toContain("name: 'AES-GCM'"); expect(vault).toContain('TenantObjectStorage'); expect(projections).toContain("),'resolved')<>'suspended'")
  })
  it('uses strict TypeBox and Studio CSS Modules without Zod, Tailwind, or app-to-app UI imports', () => {
    const files = ['apps/studio/server/fuma/expertDiscovery/contracts.ts','apps/studio/server/fuma/expertDiscovery/routes.ts','apps/studio/src/admin/fuma/expertDiscovery/client.ts','apps/studio/src/admin/fuma/expertDiscovery/ExpertDiscoveryRouteContent.tsx']
    const joined = files.map(source).join('\n'); expect(joined).toContain('Type.Object'); expect(joined).not.toContain('zod'); expect(joined).not.toContain('className="flex'); expect(joined).not.toContain('apps/web'); expect(joined).not.toContain('apps/control-surfaces')
  })
  it('keeps tenant and transfer destination authority out of scoped request bodies', () => {
    const contracts = source('apps/studio/server/fuma/expertDiscovery/contracts.ts')
    const approval = contracts.slice(contracts.indexOf('ApproveExpertReleaseCommandSchema'), contracts.indexOf('SetExpertVisibilityCommandSchema'))
    const transfer = contracts.slice(contracts.indexOf('TransferExpertCommandSchema'), contracts.indexOf('ExpertSearchQuerySchema'))
    expect(approval).not.toContain('sourceScope:'); expect(approval).not.toContain('actorId:'); expect(transfer).not.toContain('destinationScope:')
  })
})
