import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const SERVER_DIRECTORY = join(ROOT, 'server/fuma/checkout')
const UI_DIRECTORY = join(ROOT, 'src/admin/fuma/billing')
const source = (directory: string, file: string) => readFileSync(join(directory, file), 'utf8')
const all = (directory: string) => readdirSync(directory)
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .map((file) => source(directory, file))
  .join('\n')

describe('FUMA-055 platform checkout architecture', () => {
  it('uses strict TypeBox caller-intent and wire contracts without caller authority, Zod, or app imports', () => {
    const contracts = source(SERVER_DIRECTORY, 'contracts.ts')
    const initialize = contracts.slice(
      contracts.indexOf('PlatformCheckoutInitializeSchema'),
      contracts.indexOf('PlatformCheckoutCallbackSchema'),
    )
    expect(contracts).toContain('PlatformCheckoutMetadataSchema = Type.Object')
    expect(contracts).toContain('PlatformCheckoutViewSchema = Type.Object')
    expect(contracts).toContain('{ additionalProperties: false }')
    expect(initialize).toContain('source: PlatformCheckoutSourceIntentSchema')
    for (const forbidden of [
      'organizationId', 'workspaceId', 'siteId', 'amountMinor', 'currency',
      'callbackUrl', 'allowedChannels', 'payerEmail', 'internalGrant',
    ]) expect(initialize).not.toContain(forbidden)
    const server = all(SERVER_DIRECTORY)
    expect(server).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(server).not.toMatch(/from ['"](?:\.\.\/)+\.\.\/apps\//)
  })

  it('ships PostgreSQL authority with exact source checks and cross-replica initialization claims', () => {
    const postgres = source(SERVER_DIRECTORY, 'postgres.ts')
    for (const evidence of [
      'PostgresPlatformCheckoutRepository',
      'pg_advisory_xact_lock',
      'for update',
      "kind='platform-internal'",
      "offeringClass !== 'paid'",
      "candidate_state !== 'awaiting-payment'",
      'Private offer was replaced.',
      "state='initializing'",
      'claim_expires_at',
      'reference = item.reference ?? proposedReference',
    ]) expect(postgres).toContain(evidence)
    expect(postgres).toContain('setup_fee_settled')
    expect(postgres).toContain('recurring_settled')
    expect(postgres).toContain('paid_transfer_pending')
  })

  it('registers exact platform-only setup/recurring purposes and callback verification never settles', () => {
    const service = source(SERVER_DIRECTORY, 'service.ts')
    const runtime = source(SERVER_DIRECTORY, 'runtime.ts')
    expect(service).toContain("return kind === 'setup' ? 'platform-setup' : 'platform-recurring'")
    expect(service).toContain("scope: 'platform_billing' as const")
    expect(service).toContain('await repository.assertPurpose(metadata)')
    expect(service).toContain('FUMA-056 owns signed-event reduction')
    expect(service).toContain('this.#transport.verify(')
    expect(service).not.toContain('this.#transport.settle(')
    expect(runtime).toContain('registerPlatformCheckoutPurposes(input.registry, repository)')
    expect(runtime).toContain('input.transport')
  })

  it('declares trusted scoped handlers and mounts app-local settings UI without profile conditionals', () => {
    const routes = source(SERVER_DIRECTORY, 'routes.ts')
    const routeContent = source(UI_DIRECTORY, 'PlatformCheckoutRouteContent.tsx')
    const surface = source(UI_DIRECTORY, 'PlatformCheckoutSurface.tsx')
    const hostedShell = readFileSync(join(ROOT, 'src/admin/preauth/HostedStaffShell.tsx'), 'utf8')
    const serverIndex = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
    const hostedRuntime = readFileSync(join(ROOT, 'server/auth/hosted/runtime.ts'), 'utf8')
    for (const path of [
      '/billing/checkouts',
      '/billing/checkouts/:checkoutId',
      '/billing/checkouts/:checkoutId/cancel',
      '/billing/checkouts/:checkoutId/callback',
    ]) expect(routes).toContain(path)
    expect(routes).toContain("permission: 'site.settings.write'")
    expect(routes).toContain("permission: 'site.settings.read'")
    expect(routes).toContain("'cache-control': 'no-store'")
    expect(routes).toContain('payer.userId !== input.context.actor.userId')
    expect(routeContent).toContain("shell.profileRelativeSubpath !== '/admin/settings/billing'")
    expect(routeContent).toContain("id === 'site.settings'")
    expect(routeContent).not.toMatch(/profileId\s*===|profile\.id\s*===/)
    // The shared kit's Button was replaced by the shadcn one under task 80's shadcn-only standard.
    // The property this defends - the surface reuses a shared button rather than styling its own -
    // is unchanged; only which shared button moved.
    expect(surface).toContain("import { Button } from '@admin/fuma/ui/button'")
    expect(surface).toContain("rel=\"noopener noreferrer\"")
    expect(surface).toContain('Setup/import fee')
    expect(surface).toContain('Recurring consideration')
    expect(hostedShell).toContain('<PlatformCheckoutRouteContent')
    expect(serverIndex).toContain('createHostedPlatformCheckoutRuntime({')
    expect(serverIndex).toContain('transport: paystackRuntime.platformBilling')
    expect(serverIndex).toContain('checkoutRoutes: platformCheckoutRuntime.scopedRoutes')
    expect(hostedRuntime).toContain('checkoutRoutes?: readonly FumaScopedRouteDeclaration[]')
  })

  it('keeps finalized migration 000058 additive, immutable, and separate from finalized historical checkout', () => {
    const migration = readFileSync(join(ROOT, 'server/fuma/db/migrations/000058_platform_checkout_authority.ts'), 'utf8')
    const historical = readFileSync(join(ROOT, 'server/fuma/db/migrations/000027_checkout.ts'), 'utf8')
    const index = readFileSync(join(ROOT, 'server/fuma/db/migrations/index.ts'), 'utf8')
    expect(migration).not.toMatch(/\b(?:drop|truncate)\b|^\s*delete\s+from/im)
    expect(migration).toContain('create table fuma_platform_checkout_candidates_v2')
    expect(migration).toContain('create table fuma_platform_checkout_obligations_v2')
    expect(migration).toContain('fuma_platform_checkout_identity_immutable_v2')
    expect(historical).toContain("id:'000027_checkout'")
    expect(historical).not.toContain('_v2')
    expect(index).toContain("import { platformCheckoutAuthorityMigration } from './000058_platform_checkout_authority'")
    expect(index).toContain("'000058_platform_checkout_authority': '39b444f6ee4783354dda373f0f3e1315b77c77febdfb782b43984d8e63219e8b'")
  })

  it('keeps checkout modules within the repository source ceiling and UI app-local', () => {
    for (const directory of [SERVER_DIRECTORY, UI_DIRECTORY]) {
      for (const file of readdirSync(directory).filter((value) => /\.(?:ts|tsx)$/.test(value))) {
        expect(source(directory, file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
      }
    }
    // Task 80's acceptance standard makes hosted pages shadcn + Tailwind only, and the CSS-module
    // ratchet enforces that the count shrinks and never grows. Asserting the stylesheet still
    // exists would defend a policy the product has replaced.
    expect(readdirSync(UI_DIRECTORY)).toContain('PlatformCheckoutSurface.tsx')
    expect(readdirSync(UI_DIRECTORY)).not.toContain('PlatformCheckoutSurface.module.css')
    expect(all(UI_DIRECTORY)).not.toMatch(/from ['"]@fuma\/(?:public-contracts|web)/)
  })
})
