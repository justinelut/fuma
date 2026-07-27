import {
  Type,
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { FumaJobJsonValue, FumaScopedJobHandler } from '../jobs'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import { PostgresQuotaAccountRepository, DunningJobService } from './account'
import { QuotaCampaignAuthority } from './campaign'
import { QuotaUsageCollector } from './collector'
import { PostgresQuotaRepository } from './postgres'
import { createQuotaSelfServiceScopedRouteDeclarations } from './routes'
import { QuotaService } from './service'
import {
  PostgresQuotaUsageAuthority,
  quotaUsageCollectionJobRegistration,
} from './usageAuthority'

export const BILLING_DUNNING_JOB = 'fuma.billing-dunning' as const

export const BillingDunningJobPayloadSchema = Type.Object({
  periodKey: Type.String({
    minLength: 10,
    maxLength: 64,
    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2})?$',
  }),
}, { additionalProperties: false })

const DunningResultSchema = Type.Object({
  transitioned: Type.Integer({ minimum: 0 }),
  notified: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

export function billingDunningJobRegistration(input: Readonly<{
  dunning: DunningJobService
  protectedOrganizationId?: string
}>): Readonly<Record<typeof BILLING_DUNNING_JOB, FumaScopedJobHandler>> {
  const protectedOrganizationId = input.protectedOrganizationId ?? PLATFORM_ORGANIZATION_ID
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.job.kind !== BILLING_DUNNING_JOB
      || context.job.organizationId !== protectedOrganizationId
      || context.job.siteId !== null
      || context.jobContext.kind !== 'organization'
      || context.repositoryScope !== null
      || context.jobContext.scope.organization.id !== protectedOrganizationId) {
      throw new TypeError('Billing dunning requires protected platform authority.')
    }
    const payload = safeParseValue(BillingDunningJobPayloadSchema, context.job.payload)
    if (!payload.ok) throw new TypeError('Billing dunning payload is invalid.')
    const effectKey = `fuma.billing-dunning:v1:${payload.value.periodKey}`
    const prior = await context.readDurableResult(effectKey)
    if (prior) {
      const parsed = safeParseValue(DunningResultSchema, prior.result)
      if (!parsed.ok) throw new TypeError('Durable dunning result is invalid.')
      return parsed.value as FumaJobJsonValue
    }
    const result = await input.dunning.run()
    const parsed = safeParseValue(DunningResultSchema, result)
    if (!parsed.ok) throw new TypeError('Billing dunning result is invalid.')
    return (await context.commitDurableResult(
      effectKey,
      parsed.value as FumaJobJsonValue,
    )).result
  }
  return Object.freeze({ [BILLING_DUNNING_JOB]: handler })
}

export function createQuotaRuntime(input: Readonly<{
  db: DbClient
  now?: () => Date
}>) {
  const repository = new PostgresQuotaRepository(input.db, { now: input.now })
  const service = new QuotaService(repository)
  const accounts = new PostgresQuotaAccountRepository(
    input.db,
    service,
    input.now ?? (() => new Date()),
  )
  const dunning = new DunningJobService(accounts, input.now)
  const collector = new QuotaUsageCollector(service)
  const usageAuthority = new PostgresQuotaUsageAuthority(input.db, collector)
  const campaign = new QuotaCampaignAuthority(service)
  const scopedRoutes = createQuotaSelfServiceScopedRouteDeclarations({ accounts, collector })
  const jobs = Object.freeze({
    ...billingDunningJobRegistration({ dunning }),
    ...quotaUsageCollectionJobRegistration({ authority: usageAuthority }),
  })
  return Object.freeze({
    repository,
    service,
    accounts,
    dunning,
    collector,
    usageAuthority,
    campaign,
    scopedRoutes,
    jobs,
  })
}
