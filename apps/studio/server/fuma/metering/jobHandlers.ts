import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../jobs'
import type { FumaScopedJobHandler } from '../jobs/integration'
import {
  MeterReconcilePayloadSchema,
  MeterReconciliationJsonSchema,
  type MeterReconciliation,
  type ProviderUsageAuthority,
} from './contracts'
import type { MeteringService } from './service'

export const METER_RECONCILE_JOB_KIND = 'fuma.meter-reconcile' as const

function jsonResult(value: MeterReconciliation): FumaJobJsonValue {
  const result = JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as unknown
  const parsed = safeParseValue(MeterReconciliationJsonSchema, result)
  if (!parsed.ok) throw new TypeError('Meter reconciliation result failed strict TypeBox validation.')
  return parsed.value as FumaJobJsonValue
}

/** Payload contains a period only; tenant and provider authority remain server-owned. */
export function meteringJobRegistration(input: Readonly<{
  service: MeteringService
  providerUsage: ProviderUsageAuthority
  protectedOrganizationId: string
}>): Readonly<Record<typeof METER_RECONCILE_JOB_KIND, FumaScopedJobHandler>> {
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.job.kind !== METER_RECONCILE_JOB_KIND
      || context.job.organizationId !== input.protectedOrganizationId
      || context.job.siteId !== null
      || context.jobContext.kind !== 'organization'
      || context.repositoryScope !== null
      || context.jobContext.scope.organization.id !== input.protectedOrganizationId) {
      throw new TypeError('Meter reconciliation requires the protected platform organization authority.')
    }
    const parsed = safeParseValue(MeterReconcilePayloadSchema, context.job.payload)
    if (!parsed.ok || Date.parse(parsed.value.periodEnd) <= Date.parse(parsed.value.periodStart)) {
      throw new TypeError('Meter reconciliation payload is invalid.')
    }
    const effectKey = `fuma.meter-reconcile:v1:${parsed.value.periodStart}:${parsed.value.periodEnd}`
    const prior = await context.readDurableResult(effectKey)
    if (prior) {
      const validated = safeParseValue(MeterReconciliationJsonSchema, prior.result)
      if (!validated.ok || validated.value.idempotencyKey !== effectKey
        || validated.value.periodStart !== parsed.value.periodStart
        || validated.value.periodEnd !== parsed.value.periodEnd) {
        throw new TypeError('Durable meter reconciliation result is invalid.')
      }
      return validated.value as FumaJobJsonValue
    }
    const providerTotals = await input.providerUsage.totalsForPeriod(parsed.value.periodStart, parsed.value.periodEnd)
    const reconciliation = await input.service.reconcile(Object.freeze({
      ...parsed.value,
      idempotencyKey: effectKey,
      providerTotals,
    }))
    await input.providerUsage.recordReconciliation(reconciliation)
    return (await context.commitDurableResult(effectKey, jsonResult(reconciliation))).result
  }
  return Object.freeze({ [METER_RECONCILE_JOB_KIND]: handler })
}
