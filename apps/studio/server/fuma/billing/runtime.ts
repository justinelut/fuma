import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import {
  FumaJobService,
  PostgresFumaJobRepository,
  RedisFumaJobReadyQueue,
  type FumaJobJsonValue,
  type FumaScopedJobHandler,
} from '../jobs'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import { PaystackWebhookBoundary } from '../paystack/boundary'
import type { ScopedPaystackTransport } from '../paystack/transport'
import { PostgresBillingRepository } from './postgres'
import {
  PlatformBillingReconciler,
  type BillingReductionResult,
} from './reconciler'

export const PLATFORM_BILLING_RECONCILE_JOB = 'fuma.billing-reconcile' as const

export const PlatformBillingJobPayloadSchema = Type.Object({
  triggerEventId: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false })

const BillingReductionResultSchema = Type.Object({
  processed: Type.Integer({ minimum: 0, maximum: 1_000 }),
  partial: Type.Integer({ minimum: 0, maximum: 1_000 }),
  activated: Type.Integer({ minimum: 0, maximum: 1_000 }),
  handoffs: Type.Integer({ minimum: 0, maximum: 1_000 }),
  subscriptions: Type.Integer({ minimum: 0, maximum: 1_000 }),
}, { additionalProperties: false })

function resultJson(result: BillingReductionResult): FumaJobJsonValue {
  const parsed = safeParseValue(BillingReductionResultSchema, result)
  if (!parsed.ok) throw new TypeError('Billing reconciliation result is invalid.')
  return parsed.value as FumaJobJsonValue
}

export function billingJobRegistration(input: Readonly<{
  reconciler: PlatformBillingReconciler
  protectedOrganizationId?: string
}>): Readonly<Record<typeof PLATFORM_BILLING_RECONCILE_JOB, FumaScopedJobHandler>> {
  const protectedOrganizationId = input.protectedOrganizationId ?? PLATFORM_ORGANIZATION_ID
  const handler: FumaScopedJobHandler = async (context) => {
    if (
      context.job.kind !== PLATFORM_BILLING_RECONCILE_JOB
      || context.job.organizationId !== protectedOrganizationId
      || context.job.siteId !== null
      || context.jobContext.kind !== 'organization'
      || context.repositoryScope !== null
      || context.jobContext.scope.organization.id !== protectedOrganizationId
    ) {
      throw new TypeError('Billing reconciliation requires protected platform authority.')
    }
    const payload = safeParseValue(PlatformBillingJobPayloadSchema, context.job.payload)
    if (!payload.ok) throw new TypeError('Billing reconciliation payload is invalid.')
    const effectKey = `fuma.billing-reconcile:v1:${payload.value.triggerEventId}`
    const previous = await context.readDurableResult(effectKey)
    if (previous) {
      const parsed = safeParseValue(BillingReductionResultSchema, previous.result)
      if (!parsed.ok) throw new TypeError('Durable billing result is invalid.')
      return parsed.value as FumaJobJsonValue
    }
    const reduced = resultJson(await input.reconciler.reducePending())
    return (await context.commitDurableResult(effectKey, reduced)).result
  }
  return Object.freeze({ [PLATFORM_BILLING_RECONCILE_JOB]: handler })
}

export function createPlatformBillingRuntime(input: Readonly<{
  db: DbClient
  transport: ScopedPaystackTransport
  now?: () => Date
}>) {
  const repository = new PostgresBillingRepository(input.db, { now: input.now })
  const reconciler = new PlatformBillingReconciler(input.transport, repository, input.now)
  return Object.freeze({
    repository,
    reconciler,
    jobs: billingJobRegistration({ reconciler }),
  })
}

function namespace(host: string): string {
  return `billing-${host.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 48)}`
}

function triggerJobId(eventId: string): string {
  const digest = new Bun.CryptoHasher('sha256').update(eventId).digest('hex')
  return `platform-billing:${digest.slice(0, 32)}`
}

export async function createHostedPlatformBillingRuntime(input: Readonly<{
  db: DbClient
  config: FumaConfig
  platformBilling: ScopedPaystackTransport
  customerMerchant?: ScopedPaystackTransport | null
  now?: () => Date
}>) {
  const core = createPlatformBillingRuntime({
    db: input.db,
    transport: input.platformBilling,
    now: input.now,
  })
  const readyQueue = new RedisFumaJobReadyQueue(
    input.config.redis.url,
    namespace(input.config.hosts.product),
  )
  await readyQueue.connect()
  const jobs = new FumaJobService({
    repository: new PostgresFumaJobRepository(input.db, input.now),
    readyQueue,
    admission: { maxActivePerOrganization: 10_000, maxActivePerSite: 2_000 },
    now: input.now,
  })
  const enqueue = async (eventId: string): Promise<void> => {
    await jobs.enqueue({
      id: triggerJobId(eventId),
      organizationId: PLATFORM_ORGANIZATION_ID,
      kind: PLATFORM_BILLING_RECONCILE_JOB,
      payload: { triggerEventId: eventId },
      maxAttempts: 20,
      idempotencyKey: `platform-billing-event:${eventId}`,
    })
  }
  const webhooks = new PaystackWebhookBoundary({
    platformBilling: input.platformBilling,
    customerMerchant: input.customerMerchant,
    platformBillingHandler: async (raw, signature) => {
      const ingested = await core.reconciler.ingest(raw, signature)
      if (ingested.state === 'stored') await enqueue(ingested.eventId)
    },
  })
  for (const eventId of await core.reconciler.pendingEventIds(1_000)) {
    await enqueue(eventId)
  }
  return Object.freeze({
    ...core,
    webhooks,
    close: async () => await readyQueue.close(),
  })
}
