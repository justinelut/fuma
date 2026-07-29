import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue, FumaScopedJobHandler } from '../jobs'
import type { AiCreditService } from './service'

export const AI_CREDIT_EXPIRY_JOB_KIND = 'fuma.ai-credit-expiry' as const
export const AiCreditExpiryPayloadSchema = Type.Object({ limit: Type.Integer({ minimum: 1, maximum: 1000 }) }, { additionalProperties: false })
const ResultSchema = Type.Object({ expiredReservations: Type.Integer({ minimum: 0 }), runAt: Type.String({ format: 'date-time' }) }, { additionalProperties: false })
export function aiCreditExpiryJobRegistration(input: Readonly<{ service: AiCreditService; protectedOrganizationId: string; now?: () => Date }>): Readonly<Record<typeof AI_CREDIT_EXPIRY_JOB_KIND, FumaScopedJobHandler>> {
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.job.kind !== AI_CREDIT_EXPIRY_JOB_KIND || context.job.organizationId !== input.protectedOrganizationId || context.job.siteId !== null || context.jobContext.kind !== 'organization' || context.repositoryScope !== null || context.jobContext.scope.organization.id !== input.protectedOrganizationId) throw new TypeError('AI credit expiry requires protected organization job authority.')
    const payload = safeParseValue(AiCreditExpiryPayloadSchema, context.job.payload); if (!payload.ok) throw new TypeError('AI credit expiry payload is invalid.')
    const runAt = (input.now ?? (() => new Date()))().toISOString(); const effectKey = `fuma.ai-credit-expiry:v1:${runAt}:${payload.value.limit}`
    const prior = await context.readDurableResult(effectKey); if (prior) { const parsed = safeParseValue(ResultSchema, prior.result); if (!parsed.ok) throw new TypeError('AI credit expiry durable result is invalid.'); return parsed.value as FumaJobJsonValue }
    const expired = await input.service.expireDue(payload.value.limit); const result = { expiredReservations: expired.length, runAt }
    return (await context.commitDurableResult(effectKey, result)).result
  }
  return Object.freeze({ [AI_CREDIT_EXPIRY_JOB_KIND]: handler })
}
