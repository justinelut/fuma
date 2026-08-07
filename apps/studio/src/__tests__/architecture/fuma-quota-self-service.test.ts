import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..', '..')
const SERVER = join(ROOT, 'server', 'fuma', 'quotas')
const MIGRATIONS = join(ROOT, 'server', 'fuma', 'db', 'migrations')
const UI = join(ROOT, 'src', 'admin', 'fuma', 'usage')
const read = (directory: string, file: string) => readFileSync(join(directory, file), 'utf8')
const all = (directory: string) => readdirSync(directory)
  .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
  .map((file) => read(directory, file))
  .join('\n')

describe('FUMA-057 entitlement enforcement architecture', () => {
  it('defines and collects every explicit quota class through strict TypeBox contracts', () => {
    const contracts = read(SERVER, 'contracts.ts')
    const collector = read(SERVER, 'collector.ts')
    for (const quotaClass of [
      'sites', 'pages', 'cmsItems', 'members', 'storageBytes', 'bandwidthBytes',
      'emailRecipientsDay', 'emailRecipientsMonth', 'buildPublishMinutes',
      'pluginComputeMinutes', 'aiCredits', 'releaseRetentionBytes',
      'collaborators', 'customDomains',
    ]) {
      expect(contracts).toContain(quotaClass)
      expect(collector).toContain(quotaClass)
    }
    expect(contracts).toContain('QuotaUsageEnvelopeSchema = Type.Object')
    expect(collector).toContain('SetupImportForecastInputSchema = Type.Object')
    expect(collector).toContain('ContinuousQuotaUsageInputSchema = Type.Object')
    expect(all(SERVER)).not.toMatch(/from ['"]zod['"]|\bz\.(?:object|string|number)\(/)
  })

  it('synchronizes only protected grants, paid contracts, and active grandfathered evidence', () => {
    const source = read(SERVER, 'source.ts')
    expect(source).toContain("organizationId !== PLATFORM_ORGANIZATION_ID")
    expect(source).toContain("state in ('active','paid-transfer-pending')")
    expect(source).toContain("checkout_id is not null")
    expect(source).toContain("offer.state !== 'accepted'")
    expect(source).toContain("s.source='grandfathered'")
    expect(source).toContain("a.state='active'")
    expect(source).not.toContain("state='awaiting-payment'")
    expect(source).not.toContain('authorization_url')
  })

  it('uses PostgreSQL organization serialization and atomic multi-class reservation', () => {
    const postgres = read(SERVER, 'postgres.ts')
    const service = read(SERVER, 'service.ts')
    expect(postgres).toContain('pg_advisory_xact_lock')
    expect(postgres).toContain('fuma_quota_reservations_v2')
    expect(postgres).toContain('fuma_quota_reservation_items_v2')
    expect(postgres.indexOf('for (const item of input.items)')).toBeLessThan(
      postgres.indexOf('insert into fuma_quota_reservations_v2'),
    )
    expect(postgres).toContain('existing data remains readable and exportable')
    expect(service).toContain("preserveExisting = true")
    expect(service).toContain("| 'exhausted'")
  })

  it('reserves and reconciles campaign day/month quotas at the service boundary', () => {
    const campaign = read(SERVER, 'campaign.ts')
    const delivery = readFileSync(join(ROOT, 'server', 'fuma', 'publication', 'campaignDelivery.ts'), 'utf8')
    const composition = readFileSync(join(ROOT, 'server', 'fuma', 'publication', 'composition.ts'), 'utf8')
    expect(campaign).toContain("quotaClass: 'emailRecipientsDay'")
    expect(campaign).toContain("quotaClass: 'emailRecipientsMonth'")
    expect(delivery).toContain('this.#campaignQuota?.reserve(')
    expect(delivery).toContain('this.#campaignQuota?.settle(')
    expect(delivery).toContain('this.#campaignQuota?.release(')
    expect(delivery.indexOf('this.#campaignQuota?.reserve(')).toBeLessThan(
      delivery.indexOf("transitionCampaignStatus(scope, campaignId, expected, 'sending')"),
    )
    expect(composition).toContain('campaignQuota?:CampaignQuotaAuthority')
  })

  it('keeps protected internal self-service free of customer billing/provider/shadow-cost data', () => {
    const account = read(SERVER, 'account.ts')
    const gate = read(UI, 'QuotaSelfServiceRouteContent.tsx')
    expect(account).toContain("state.source === 'platform-internal'")
    expect(account).toContain('{ ...base, billing: null }')
    expect(gate).toContain('model.billing === null')
    expect(gate.indexOf('model.billing === null')).toBeLessThan(gate.indexOf('{customerBilling}'))
    expect(account).not.toMatch(/shadowCost\s*:/)
    expect(account).not.toMatch(/provider\s*:/)
    expect(all(UI)).not.toMatch(/from ['"]@fuma\/(?:public-contracts|web)/)
  })

  it('declares read/export/top-up/cancellation routes and protected durable dunning', () => {
    const routes = read(SERVER, 'routes.ts')
    const runtime = read(SERVER, 'runtime.ts')
    for (const path of [
      '/quotas/self-service',
      '/quotas/self-service/export',
      '/quotas/forecast',
      '/quotas/top-up-requests',
      '/billing/cancellation',
    ]) expect(routes).toContain(path)
    expect(routes).toContain("'cache-control': 'no-store'")
    expect(routes).toContain("permission: 'site.settings.read'")
    expect(routes).toContain("permission: 'site.settings.write'")
    expect(runtime).toContain("BILLING_DUNNING_JOB = 'fuma.billing-dunning'")
    expect(runtime).toContain("context.jobContext.kind !== 'organization'")
    expect(runtime).toContain('context.repositoryScope !== null')
    expect(runtime).toContain('context.jobContext.scope.organization.id !== protectedOrganizationId')
  })

  it('composes quotas into hosted API, both publication graphs, durable worker, and UI gate', () => {
    const hostedApi = readFileSync(join(ROOT, 'server', 'auth', 'hosted', 'runtime.ts'), 'utf8')
    const server = readFileSync(join(ROOT, 'server', 'index.ts'), 'utf8')
    const publication = readFileSync(join(ROOT, 'server', 'fuma', 'publication', 'runtime.ts'), 'utf8')
    const worker = readFileSync(join(ROOT, 'server', 'fuma', 'publication', 'workerComposition.ts'), 'utf8')
    const shell = readFileSync(join(ROOT, 'src', 'admin', 'preauth', 'HostedStaffShell.tsx'), 'utf8')
    expect(hostedApi).toContain('quotaRoutes?: readonly FumaScopedRouteDeclaration[]')
    expect(hostedApi).toContain('...(input.quotaRoutes ?? [])')
    expect(server).toContain('const quotaRuntime = hostedFumaConfig ? createQuotaRuntime({ db })')
    expect(server).toContain('campaignQuota: quotaRuntime.campaign')
    expect(server).toContain('quotaRoutes: quotaRuntime.scopedRoutes')
    expect(publication).toContain('campaignQuota?:CampaignQuotaAuthority')
    expect(worker).toContain('const quota = createQuotaRuntime({ db })')
    expect(worker).toContain('campaignQuota: quota.campaign')
    expect(worker).toContain('...quota.jobs')
    expect(shell).toContain('<QuotaSelfServiceRouteContent')
    expect(shell).toContain('customerBilling={(')
    expect(shell).toContain('<PlatformCheckoutRouteContent')
  })

  it('builds complete trusted continuous observations and protects their durable job', () => {
    const authority = read(SERVER, 'usageAuthority.ts')
    expect(authority).toContain('class PostgresQuotaUsageAuthority')
    expect(authority).toContain('from fuma_usage_ledger')
    expect(authority).toContain('from auth_members')
    expect(authority).toContain('from fuma_publication_member_accounts')
    expect(authority).toContain('from fuma_publication_content')
    expect(authority).toContain("QUOTA_USAGE_COLLECTION_JOB = 'fuma.quota-usage-collection'")
    expect(authority).toContain('context.repositoryScope !== null')
    expect(authority).toContain('quotaUsageFromWorkload')
    for (const meter of [
      'storage_source_bytes', 'storage_variant_bytes', 'storage_release_bytes',
      'storage_local_backup_bytes', 'storage_offsite_bytes', 'origin_bandwidth_bytes',
      'email_recipients', 'custom_hostnames', 'build_publish_milliseconds',
      'plugin_compute_milliseconds', 'ai_credits', 'release_retention_bytes',
    ]) expect(authority).toContain(meter)
  })

  it('registers the conductor-finalized additive migration with its immutable checksum', () => {
    const bridge = read(SERVER, 'migration.ts')
    const migration = read(MIGRATIONS, '000060_quota_self_service.ts')
    const migrationIndex = read(MIGRATIONS, 'index.ts')
    const releaseMigration = readFileSync(join(ROOT, 'src', '__tests__', 'fuma', 'releaseMigration.test.ts'), 'utf8')
    expect(bridge).toContain('quotaSelfServiceMigration as quotaSelfServiceMigrationCandidate')
    expect(migration).toContain("id: '000060_quota_self_service'")
    expect(migration).toContain('fuma_quota_entitlement_snapshots_v2')
    expect(migration).toContain('fuma_quota_usage_observations_v2')
    expect(migration).toContain('fuma_billing_accounts_v2')
    expect(migration).toContain('fuma_quota_immutable_evidence_v2')
    expect(migration).not.toMatch(/\b(?:drop|truncate)\b|^\s*delete\s+from/im)
    expect(migrationIndex).toContain("import { quotaSelfServiceMigration } from './000060_quota_self_service'")
    expect(migrationIndex).toContain("'000060_quota_self_service': 'af8a6667a5a2bc2275e2c48f07679a8547193c0a1d9bacf5f1424be523c429e7'")
    expect(releaseMigration).toContain(".toBe('000078_release_followup')")
  })

  it('keeps quota and app-local usage modules under source ceilings', () => {
    for (const directory of [SERVER, UI]) {
      for (const file of readdirSync(directory).filter((value) => /\.(?:ts|tsx)$/.test(value))) {
        expect(read(directory, file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
      }
    }
    // The usage surface no longer carries a stylesheet: task 80's acceptance standard makes hosted
    // pages shadcn + Tailwind only, and the CSS-module ratchet in page-acceptance.test.ts enforces
    // that the count may shrink and never grow. Asserting the stylesheet still EXISTS would defend a
    // policy the product has replaced, so this asserts the surface itself is present instead.
    expect(readdirSync(UI)).toContain('UsageSurface.tsx')
    expect(readdirSync(UI)).not.toContain('UsageSurface.module.css')
  })
})
