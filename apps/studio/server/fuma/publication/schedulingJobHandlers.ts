import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaScopedJobHandler } from '../jobs'
import { bindPublicationScope } from './scope'
import type { PublicationSchedulingService } from './schedulingAccess'

const ScheduleDuePayloadSchema = Type.Object({ scheduleId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }) }, { additionalProperties: false })

/** Additive handler map; central worker composition can merge this without exposing scope in payloads. */
export function createPublicationSchedulingJobHandlers(service: Pick<PublicationSchedulingService, 'runDue'>): Readonly<Record<string, FumaScopedJobHandler>> {
  return Object.freeze({
    'publication.schedule-due': async (context) => {
      const parsed = safeParseValue(ScheduleDuePayloadSchema, context.job.payload)
      if (!parsed.ok) throw new TypeError('Publication schedule-due payload is invalid.')
      if (context.jobContext.kind !== 'site' || context.repositoryScope === null) throw new TypeError('Publication schedule jobs require trusted site authority.')
      const scope = bindPublicationScope(context.repositoryScope, context.jobContext.profile.id)
      const effectKey = `publication-schedule:${parsed.value.scheduleId}`
      const existing = await context.readDurableResult(effectKey)
      if (existing) return existing.result
      const result = await service.runDue(scope, parsed.value.scheduleId, `${context.jobContext.actor.jobId}:${context.fence}`)
      return (await context.commitDurableResult(effectKey, result)).result
    },
  })
}
