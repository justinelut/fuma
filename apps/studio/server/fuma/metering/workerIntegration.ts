import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../jobs'
import type { FumaScopedJobHandler } from '../jobs/integration'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import { assertReleaseManifest } from '../releases'
import { WorkloadMeasurementSchema, type MeteringCollector, type WorkloadMeasurement } from './collector'

const NewsletterResultSchema = Type.Object({
  campaignId: Type.String({ minLength: 1 }),
  snapshotSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  status: Type.String({ minLength: 1 }),
  recipientCount: Type.Integer({ minimum: 0 }),
  deliveryCount: Type.Integer({ minimum: 0 }),
  messageSizeBytes: Type.Integer({ minimum: 0 }),
  meteredAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })

function site(context: Parameters<FumaScopedJobHandler>[0]) {
  if (context.jobContext.kind !== 'site' || context.repositoryScope === null) throw new TypeError('Metered workload requires trusted site authority.')
  return context.repositoryScope
}

async function stableMeasurement(
  context: Parameters<FumaScopedJobHandler>[0],
  effectKey: string,
  create: () => WorkloadMeasurement,
): Promise<WorkloadMeasurement> {
  const prior = await context.readDurableResult(effectKey)
  if (prior) {
    const parsed = safeParseValue(WorkloadMeasurementSchema, prior.result)
    if (!parsed.ok) throw new TypeError('Durable workload measurement is invalid.')
    return parsed.value
  }
  const value = create()
  const parsed = safeParseValue(WorkloadMeasurementSchema, value)
  if (!parsed.ok) throw new TypeError('Workload measurement is invalid.')
  const committed = await context.commitDurableResult(effectKey, parsed.value as FumaJobJsonValue)
  const durable = safeParseValue(WorkloadMeasurementSchema, committed.result)
  if (!durable.ok) throw new TypeError('Committed workload measurement is invalid.')
  return durable.value
}

export function withPublishMetering(
  handler: FumaScopedJobHandler,
  collector: MeteringCollector,
): FumaScopedJobHandler {
  return async (context) => {
    const result = await handler(context)
    assertReleaseManifest(result)
    const scope = site(context)
    const measurement = await stableMeasurement(context, 'fuma.meter-publish:v1', () => {
      const claimedAt = Date.parse(context.job.updatedAt)
      const createdAt = Date.parse(context.job.createdAt)
      const finalizedAt = Date.parse(result.createdAt)
      return Object.freeze({
        kind: 'publish' as const,
        idempotencyKey: `publish:${context.job.id}`,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        occurredAt: result.createdAt,
        internalWorkload: scope.organizationId === PLATFORM_ORGANIZATION_ID,
        publishes: 1,
        buildMilliseconds: Math.max(1, finalizedAt - claimedAt),
        weightedQueueMilliseconds: Math.max(1, claimedAt - createdAt),
        releaseBytes: result.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
      })
    })
    await collector.record(measurement)
    return result as FumaJobJsonValue
  }
}

export function withNewsletterMetering(
  handler: FumaScopedJobHandler,
  collector: MeteringCollector,
): FumaScopedJobHandler {
  return async (context) => {
    const result = await handler(context)
    const parsed = safeParseValue(NewsletterResultSchema, result)
    if (!parsed.ok) throw new TypeError('Newsletter result cannot be metered.')
    const scope = site(context)
    const totalBytes = parsed.value.messageSizeBytes * parsed.value.recipientCount
    if (!Number.isSafeInteger(totalBytes)) throw new TypeError('Newsletter message-byte total exceeds safe metering units.')
    await collector.record(Object.freeze({
      kind: 'newsletter',
      idempotencyKey: `newsletter:${context.job.id}:${parsed.value.snapshotSha256}`,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
      occurredAt: parsed.value.meteredAt,
      internalWorkload: scope.organizationId === PLATFORM_ORGANIZATION_ID,
      recipients: parsed.value.recipientCount,
      messageBytes: totalBytes,
    }))
    return result
  }
}
