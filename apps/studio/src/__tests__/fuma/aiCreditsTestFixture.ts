import type { AiCatalogQuote } from '../../../server/fuma/aiCatalog'
import {
  AiCreditService,
  DeterministicAiByokMetadataCipher,
  MemoryAiCreditRepository,
  type AiCreditAuditPort,
  type AiCreditMeterPort,
  type AiCreditQuotaPort,
} from '../../../server/fuma/aiCredits'

export const AI_CREDIT_NOW = new Date('2026-07-28T12:00:00.000Z')
export const aiCreditScope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  ownerKey: 'owner-a',
  ownerGeneration: 1,
})
export const aiCreditAudience = Object.freeze({
  kind: 'customer' as const,
  platformId: 'fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  profile: 'website' as const,
})

type QuoteRequest = Readonly<{
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
}>

export class FixtureAiCatalog {
  readonly requests: QuoteRequest[] = []
  fail: Error | null = null
  priceMultiplier = 1

  async quote(_audience: unknown, raw: unknown): Promise<AiCatalogQuote> {
    if (this.fail) throw this.fail
    const request = structuredClone(raw) as QuoteRequest
    this.requests.push(request)
    const providerCostMicros = Math.ceil(
      ((request.inputTokens * 1_000_000 + request.outputTokens * 2_000_000)
        / 1_000_000) * this.priceMultiplier,
    )
    const markupMicros = Math.ceil(providerCostMicros * 2_500 / 10_000)
    const included = request.modelId === 'included-model'
    return Object.freeze({
      ...request,
      providerCostMicros,
      markupMicros,
      chargeMicros: included ? 0 : providerCostMicros + markupMicros,
      included,
    })
  }
}

export function createAiCreditFixture() {
  const repository = new MemoryAiCreditRepository()
  const catalog = new FixtureAiCatalog()
  const cipher = new DeterministicAiByokMetadataCipher('fixture-kms-key')
  const clock = { now: new Date(AI_CREDIT_NOW) }
  const quotaEvents: string[] = []
  const meterEvents: Array<Readonly<Record<string, unknown>>> = []
  const auditEvents: Array<Readonly<Record<string, unknown>>> = []
  const quota: AiCreditQuotaPort = {
    async reserve(key) { quotaEvents.push(`reserve:${key}`) },
    async settle(key, units) { quotaEvents.push(`settle:${key}:${units}`) },
    async release(key) { quotaEvents.push(`release:${key}`) },
  }
  const meter: AiCreditMeterPort = {
    async settle(input) { meterEvents.push(structuredClone(input)) },
  }
  const audit: AiCreditAuditPort = {
    async record(fact) { auditEvents.push(structuredClone(fact)) },
  }
  const service = new AiCreditService({
    repository,
    catalog,
    cipher,
    quota,
    meter,
    audit,
    now: () => clock.now,
  })
  return {
    repository,
    catalog,
    cipher,
    clock,
    quotaEvents,
    meterEvents,
    auditEvents,
    service,
  }
}

export function grantCommand(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    lotId: 'grant-a',
    accountId: 'account-a',
    scope: aiCreditScope,
    amountMicros: 5_000_000,
    budgetMicros: 5_000_000,
    expiresAt: '2026-07-29T12:00:00.000Z',
    evidenceId: 'grant-evidence-a',
    idempotencyKey: 'grant-key-a',
    ...overrides,
  }
}

export async function reserveCommand(
  fixture: ReturnType<typeof createAiCreditFixture>,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Readonly<Record<string, unknown>>> {
  const account = (await fixture.repository.snapshot('account-a'))!.account
  return {
    reservationId: 'reservation-a',
    accountId: 'account-a',
    scope: aiCreditScope,
    audience: aiCreditAudience,
    providerId: 'provider-a',
    modelId: 'paid-model',
    estimatedInputTokens: 1_000_000,
    estimatedOutputTokens: 1_000_000,
    mode: 'platform',
    byokCredentialId: null,
    expiresAt: '2026-07-28T12:30:00.000Z',
    expectedAccountVersion: account.version,
    idempotencyKey: 'reservation-key-a',
    ...overrides,
  }
}
