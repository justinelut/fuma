import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/entitlements')
const source = (file: string) => readFileSync(join(DIRECTORY, file), 'utf8')
const all = () => readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts')).map(source).join('\n')

describe('FUMA-054 entitlement architecture', () => {
  it('uses strict TypeBox contracts without Zod or app-to-app imports', () => {
    const text = all()
    for (const schema of ['PriceBookDraftSchema', 'CustomOfferDraftSchema', 'InternalGrantSchema', 'GrandfatheredAssignmentSchema', 'EntitlementSnapshotSchema']) {
      expect(text).toContain(`${schema} = Type.Object`)
    }
    expect(text).toContain('{ additionalProperties: false }')
    expect(text).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(text).not.toMatch(/from ['"](?:\.\.\/)+\.\.\/apps\//)
  })

  it('keeps public pricing projection explicit and private economics server-only', () => {
    const economics = source('economics.ts')
    const contracts = source('contracts.ts')
    expect(economics).toContain('Value.Check(PublicPricingPlanSchema, candidate)')
    expect(economics).toContain('quotas,')
    expect(contracts).toContain('publicJson: Type.Object')
    for (const privateField of ['economics', 'workloadAssumptions', 'costModelVersion']) {
      const projection = economics.slice(economics.indexOf('const candidate'), economics.indexOf('if (!Value.Check(PublicPricingPlanSchema'))
      expect(projection).not.toContain(privateField)
    }
  })

  it('binds the sole internal grant to the protected platform organization and denies provider/billing paths', () => {
    const service = source('service.ts')
    const memory = source('memory.ts')
    expect(service).toContain("organizationId !== PLATFORM_ORGANIZATION_ID")
    expect(service).toContain("grantId: 'platform-internal'")
    expect(service).toContain('providerCustomerId: null')
    expect(service).toContain('billingAllowed: false, providerAllowed: false')
    expect(memory).toContain("grant.organizationId !== PLATFORM_ORGANIZATION_ID")
  })

  it('ships PostgreSQL repository/runtime authority and atomic awaiting-payment acceptance only', () => {
    const postgres = source('postgres.ts')
    const runtime = source('runtime.ts')
    const server = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
    expect(postgres).toContain('class PostgresEntitlementRepository')
    expect(postgres).toContain('class PostgresOfferDestinationAuthority')
    expect(postgres).toContain('for update of o')
    expect(postgres).toContain("'awaiting-payment',false,false,null,false")
    expect(postgres).not.toContain("state='active'")
    expect(runtime).toContain('PostgresProviderCostCatalog')
    expect(runtime).toContain('PostgresEntitlementRepository')
    expect(runtime).toContain('FUMA_KES_FX_VERSION')
    expect(runtime).toContain('(usdMicros * numerator + denominator - 1n) / denominator')
    expect(server).toContain('createHostedEntitlementRuntime({')
    expect(server).toContain('costConversionVersion: hostedKesCostConversion.version')
    expect(server).toContain('process.env.FUMA_KES_FX_VERSION?.trim()')
    expect(server).toContain('&& process.env.FUMA_KES_MINOR_NUMERATOR?.trim()')
    expect(server).toContain('&& process.env.FUMA_USD_MICROS_DENOMINATOR?.trim()')
    expect(server).toContain('hostedFumaConfig && hostedKesCostConfigured')
  })

  it('keeps finalized migration 000057 registered, additive, immutable, and lifecycle-exact', () => {
    const migration = readFileSync(join(ROOT, 'server/fuma/db/migrations/000057_entitlement_evidence.ts'), 'utf8')
    const index = readFileSync(join(ROOT, 'server/fuma/db/migrations/index.ts'), 'utf8')
    expect(index).toContain("import { entitlementEvidenceMigration } from './000057_entitlement_evidence'")
    expect(index).toContain("'000057_entitlement_evidence': '0aa1ce2983b7e4781c03f2d8f437be1779a75f3cd5d31f7b0e24197a87c6f016'")
    expect(migration).not.toMatch(/\b(?:drop|truncate)\b|^\s*delete\s+from/im)
    for (const table of ['fuma_price_book_evidence', 'fuma_custom_offer_evidence', 'fuma_entitlement_assignments', 'fuma_entitlement_snapshots', 'fuma_grandfathered_assignments']) {
      expect(migration).toContain(`create table ${table}`)
    }
    expect(migration).toContain("old.state = 'issued' and new.state in ('accepted', 'withdrawn', 'expired')")
    expect(migration).toContain("state <> 'awaiting-payment'")
    expect(migration).toContain('pre-FUMA-054 commercial rows require reviewed immutable-evidence backfill')
  })

  it('keeps every entitlement module within the repository source ceiling', () => {
    for (const file of readdirSync(DIRECTORY).filter((value) => value.endsWith('.ts'))) {
      expect(source(file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
    }
  })
})
