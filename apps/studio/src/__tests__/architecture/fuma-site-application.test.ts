import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertHostedMigrationManifest } from '../../../server/fuma/db/migrationPolicy'
import { HOSTED_MIGRATION_CHECKSUMS, hostedMigrations, runnableHostedMigrations } from '../../../server/fuma/db/migrations'

const ROOT = join(import.meta.dir, '../../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('FUMA-SITE-005 application and compatibility architecture', () => {
  test('keeps the tenant Next app isolated from Studio, database, providers, shared UI, Zod, and tenant server imports', () => {
    const files = [
      'apps/site-runtime/lib/contracts.ts', 'apps/site-runtime/lib/private-runtime-client.ts',
      'apps/site-runtime/components/application-state.tsx', 'apps/site-runtime/components/legacy-compatibility-frame.tsx',
      'apps/site-runtime/app/%5F_fuma/runtime/v1/mutations/route.ts',
    ].map(read).join('\n')
    expect(files).not.toMatch(/from ['"][^'"]*apps\/studio|@fuma\/shared-ui|from ['"]zod|DATABASE_URL|postgres|provider SDK|import\([^)]*tenant/i)
    expect(files).toContain('SiteApplicationMutationCommandSchema')
    expect(files).toContain("cache: 'no-store'")
  })

  test('persists state above page navigation and rolls optimistic failures back without cross-realm reuse', () => {
    const layout = read('apps/site-runtime/app/layout.tsx')
    const provider = read('apps/site-runtime/components/application-state.tsx')
    const machine = read('apps/site-runtime/lib/application-state-machine.ts')
    expect(layout).toContain('<ApplicationStateProvider><NavigationStateProvider>')
    expect(provider).toContain("fetch('/__fuma/runtime/v1/mutations'")
    expect(provider).toContain('rollbackApplicationSnapshot')
    expect(machine).toContain('left.cacheIdentity.ownerGeneration === right.cacheIdentity.ownerGeneration')
    expect(machine).toContain('left.member.sessionId === right.member.sessionId')
  })

  test('renders legacy compatibility only in an opaque script sandbox with an isolated no-network CSP', () => {
    const frame = read('apps/site-runtime/components/legacy-compatibility-frame.tsx')
    const contracts = read('apps/studio/server/fuma/siteRuntime/applicationContracts.ts')
    expect(frame).toContain('sandbox="allow-scripts"')
    expect(frame).not.toContain('allow-same-origin')
    expect(frame).toContain('referrerPolicy="no-referrer"')
    expect(contracts).toContain("connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
    expect(contracts).not.toContain("connect-src *")
  })

  test('qualifies public cache by rollout version and keeps member/mutation responses private no-store', () => {
    const contracts = read('apps/studio/server/fuma/siteRuntime/contracts.ts')
    const service = read('apps/studio/server/fuma/siteRuntime/service.ts')
    const proxy = read('apps/site-runtime/proxy.ts')
    expect(contracts).toContain('rolloutPolicyVersion')
    expect(service).toContain("if (projection.audience.kind === 'public') try")
    expect(service).toContain('rolloutPolicyVersion: rolloutPolicy.version')
    expect(proxy).toContain("response.headers.set('cache-control', 'private, no-store')")
    expect(proxy).toContain("response.headers.set('vary', 'Cookie')")
  })

  test('registers native-accepted additive 000072 only after immutable 000071', () => {
    const applicationIndex = hostedMigrations.findIndex(({ id }) => id === '000072_site_runtime_application')
    expect(applicationIndex).toBeGreaterThan(0)
    expect(hostedMigrations[applicationIndex - 1]?.id).toBe('000071_artifact_review_marketplace')
    expect(hostedMigrations[applicationIndex + 1]?.id).toBe('000073_customer_payment_plugin')
    expect(HOSTED_MIGRATION_CHECKSUMS['000071_artifact_review_marketplace']).toBe('168275b6e4f9861ca4b931bec3e8118c5ac23506219d2f632912a4acff905f41')
    expect(HOSTED_MIGRATION_CHECKSUMS['000072_site_runtime_application']).toBe('48b68eb8fa97e6f47a9ef97c510adedd975e88ef39425d9b26e3b24db74722da')
    expect(runnableHostedMigrations.map(({ id }) => id)).toContain('000072_site_runtime_application')
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)).not.toThrow()
  })
})
