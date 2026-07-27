import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..', '..')
const SERVER = join(ROOT, 'server', 'fuma', 'quotas')
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

  it('keeps the worker migration additive and immutable without registering an unfinished ID', () => {
    const migration = read(SERVER, 'migration.ts')
    const migrationIndex = readFileSync(join(ROOT, 'server', 'fuma', 'db', 'migrations', 'index.ts'), 'utf8')
    expect(migration).toContain("id: 'unfinalized_fuma057_quota_self_service'")
    expect(migration).toContain('fuma_quota_entitlement_snapshots_v2')
    expect(migration).toContain('fuma_quota_usage_observations_v2')
    expect(migration).toContain('fuma_billing_accounts_v2')
    expect(migration).toContain('fuma_quota_immutable_evidence_v2')
    expect(migration).not.toMatch(/\b(?:drop|truncate)\b|^\s*delete\s+from/im)
    expect(migrationIndex).not.toContain('unfinalized_fuma057_quota_self_service')
  })

  it('keeps quota and app-local usage modules under source ceilings', () => {
    for (const directory of [SERVER, UI]) {
      for (const file of readdirSync(directory).filter((value) => /\.(?:ts|tsx)$/.test(value))) {
        expect(read(directory, file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
      }
    }
    expect(readdirSync(UI)).toContain('UsageSurface.module.css')
  })
})
