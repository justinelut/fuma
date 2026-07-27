import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import type { MeterClass, UsageLedgerEntry } from './contracts'
import type { MeteringService } from './service'

const Id = Type.String({ minLength: 1, maxLength: 255 })
const NullableId = Type.Union([Id, Type.Null()])
const Units = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const common = {
  idempotencyKey: Type.String({ minLength: 1, maxLength: 400 }),
  organizationId: Id,
  workspaceId: NullableId,
  siteId: NullableId,
  occurredAt: Type.String({ format: 'date-time' }),
  internalWorkload: Type.Boolean(),
}
export const WorkloadMeasurementSchema = Type.Union([
  Type.Object({ ...common, kind: Type.Literal('storage'), logicalBytes: Units, sourceBytes: Units, variantBytes: Units, releaseBytes: Units, localBackupBytes: Units, offsiteBytes: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('origin-bandwidth'), responses: Units, bytes: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('newsletter'), recipients: Units, messageBytes: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('custom-hostname'), hostnames: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('publish'), publishes: Units, buildMilliseconds: Units, weightedQueueMilliseconds: Units, releaseBytes: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('plugin-compute'), invocations: Units, milliseconds: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('ai'), logicalCredits: Units, providerCredits: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('release-retention'), logicalBytes: Units, retainedBytes: Units }, { additionalProperties: false }),
  Type.Object({ ...common, kind: Type.Literal('entity-count'), meter: Type.Union([Type.Literal('sites'), Type.Literal('pages'), Type.Literal('cms_items'), Type.Literal('members')]), units: Units }, { additionalProperties: false }),
])
export type WorkloadMeasurement = Readonly<Static<typeof WorkloadMeasurementSchema>>

type Pair = readonly [meter: MeterClass, logical: number, physical: number]
function pairs(value: WorkloadMeasurement): readonly Pair[] {
  switch (value.kind) {
    case 'storage': return [
      ['storage_source_bytes', value.logicalBytes, value.sourceBytes],
      ['storage_variant_bytes', value.logicalBytes, value.variantBytes],
      ['storage_release_bytes', value.logicalBytes, value.releaseBytes],
      ['storage_local_backup_bytes', value.logicalBytes, value.localBackupBytes],
      ['storage_offsite_bytes', value.logicalBytes, value.offsiteBytes],
    ]
    case 'origin-bandwidth': return [['origin_bandwidth_bytes', value.responses, value.bytes]]
    case 'newsletter': return [
      ['email_recipients', value.recipients, value.recipients],
      ['email_message_bytes', value.recipients, value.messageBytes],
    ]
    case 'custom-hostname': return [['custom_hostnames', value.hostnames, value.hostnames]]
    case 'publish': return [
      ['build_publish_milliseconds', value.publishes, value.buildMilliseconds],
      ['weighted_queue_milliseconds', value.publishes, value.weightedQueueMilliseconds],
      ['storage_release_bytes', value.releaseBytes, value.releaseBytes],
    ]
    case 'plugin-compute': return [['plugin_compute_milliseconds', value.invocations, value.milliseconds]]
    case 'ai': return [['ai_credits', value.logicalCredits, value.providerCredits]]
    case 'release-retention': return [['release_retention_bytes', value.logicalBytes, value.retainedBytes]]
    case 'entity-count': return [[value.meter, value.units, value.units]]
  }
}

/** Trusted adapters convert subsystem-specific measurements into immutable physical usage entries. */
export class MeteringCollector {
  readonly #service: MeteringService

  constructor(service: MeteringService) { this.#service = service }

  async record(raw: unknown): Promise<readonly UsageLedgerEntry[]> {
    if (!Value.Check(WorkloadMeasurementSchema, raw)) throw new TypeError('Workload measurement failed strict TypeBox validation.')
    const value = Object.freeze(structuredClone(raw)) as WorkloadMeasurement
    const results: UsageLedgerEntry[] = []
    for (const [meter, logicalUnits, physicalUnits] of pairs(value)) {
      if (logicalUnits === 0 && physicalUnits === 0) continue
      results.push(await this.#service.adjust(Object.freeze({
        idempotencyKey: `${value.idempotencyKey}:${meter}`,
        organizationId: value.organizationId,
        workspaceId: value.workspaceId,
        siteId: value.siteId,
        meter,
        logicalUnits,
        physicalUnits,
        occurredAt: value.occurredAt,
        internalWorkload: value.internalWorkload,
      })))
    }
    return Object.freeze(results)
  }
}
