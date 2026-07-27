import {
  Type,
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import { WorkloadAssumptionsSchema } from '../entitlements/contracts'
import {
  QuotaUsageEnvelopeSchema,
  type QuotaActualObservation,
  type QuotaForecastResult,
  type QuotaUsageEnvelope,
} from './contracts'
import { QuotaError, type QuotaService } from './service'

const IdSchema = Type.String({ minLength: 1, maxLength: 512 })
const TimestampSchema = Type.String({ format: 'date-time' })
const UnitsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

export const SetupImportForecastInputSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  kind: Type.Union([Type.Literal('setup'), Type.Literal('import')]),
  workload: WorkloadAssumptionsSchema,
  collaborators: UnitsSchema,
}, { additionalProperties: false })

export const ContinuousQuotaUsageInputSchema = Type.Object({
  idempotencyKey: IdSchema,
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  observedAt: TimestampSchema,
  usage: QuotaUsageEnvelopeSchema,
  source: Type.Optional(Type.Union([
    Type.Literal('continuous'),
    Type.Literal('reconciliation'),
  ])),
}, { additionalProperties: false })

function add(values: readonly number[], label: string): number {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new QuotaError('invalid', `${label} exceeds the supported quota range.`)
  }
  return total
}

function minutes(milliseconds: number): number {
  if (milliseconds === 0) return 0
  return Math.ceil(milliseconds / 60_000)
}

/** Maps FUMA-052 trusted logical workload measurements into all quota classes. */
export function quotaUsageFromWorkload(
  workload: Readonly<{
    sites: number
    pages: number
    cms_items: number
    members: number
    storage_source_bytes: number
    storage_variant_bytes: number
    storage_release_bytes: number
    storage_local_backup_bytes: number
    storage_offsite_bytes: number
    origin_bandwidth_bytes: number
    email_recipients: number
    email_message_bytes: number
    custom_hostnames: number
    build_publish_milliseconds: number
    plugin_compute_milliseconds: number
    ai_credits: number
    release_retention_bytes: number
    weighted_queue_milliseconds: number
  }>,
  collaborators: number,
): QuotaUsageEnvelope {
  const candidate = {
    sites: workload.sites,
    pages: workload.pages,
    cmsItems: workload.cms_items,
    members: workload.members,
    storageBytes: add([
      workload.storage_source_bytes,
      workload.storage_variant_bytes,
      workload.storage_release_bytes,
      workload.storage_local_backup_bytes,
      workload.storage_offsite_bytes,
    ], 'Storage forecast'),
    bandwidthBytes: workload.origin_bandwidth_bytes,
    emailRecipientsDay: workload.email_recipients,
    emailRecipientsMonth: workload.email_recipients,
    buildPublishMinutes: minutes(workload.build_publish_milliseconds),
    pluginComputeMinutes: minutes(workload.plugin_compute_milliseconds),
    aiCredits: workload.ai_credits,
    releaseRetentionBytes: workload.release_retention_bytes,
    collaborators,
    customDomains: workload.custom_hostnames,
  }
  const parsed = safeParseValue(QuotaUsageEnvelopeSchema, candidate)
  if (!parsed.ok) throw new QuotaError('invalid', 'Trusted workload could not map to the complete quota vocabulary.')
  return Object.freeze(parsed.value)
}

export class QuotaUsageCollector {
  readonly #service: QuotaService

  constructor(service: QuotaService) {
    this.#service = service
  }

  async forecast(raw: unknown): Promise<QuotaForecastResult> {
    const parsed = safeParseValue(SetupImportForecastInputSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Setup/import quota forecast is invalid.')
    return await this.#service.forecast({
      organizationId: parsed.value.organizationId,
      kind: parsed.value.kind,
      projected: quotaUsageFromWorkload(parsed.value.workload, parsed.value.collaborators),
    })
  }

  async collect(raw: unknown): Promise<Readonly<{
    duplicate: boolean
    notices: readonly Readonly<{
      organizationId: string
      quotaClass: string
      percent: 50 | 75 | 90 | 100
      used: number
      limit: number
      emittedAt?: string
    }>[]
  }>> {
    const parsed = safeParseValue(ContinuousQuotaUsageInputSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Continuous quota usage observation is invalid.')
    const observation: QuotaActualObservation = Object.freeze({
      idempotencyKey: parsed.value.idempotencyKey,
      organizationId: parsed.value.organizationId,
      observedAt: parsed.value.observedAt,
      usage: parsed.value.usage,
      source: parsed.value.source ?? 'continuous',
    })
    return await this.#service.observe(observation)
  }
}
