import { createHash } from 'node:crypto'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const RequiredIdentifierSchema = Type.String({ minLength: 1, maxLength: 512, pattern: '\\S' })

export const ORGANIZATION_INVITATION_DELIVERY_JOB_KIND = 'organization.invitation.deliver'

/** The durable payload is an opaque authority reference, never an email, acceptance body, or provider secret. */
export const InvitationDeliveryJobPayloadSchema = Type.Object({
  invitationId: RequiredIdentifierSchema,
}, { additionalProperties: false })
export type InvitationDeliveryJobPayload = Static<typeof InvitationDeliveryJobPayloadSchema>

export const EnqueueInvitationDeliveryInputSchema = Type.Object({
  organizationId: RequiredIdentifierSchema,
  invitationId: RequiredIdentifierSchema,
}, { additionalProperties: false })
export type EnqueueInvitationDeliveryInput = Static<typeof EnqueueInvitationDeliveryInputSchema>

export type InvitationDeliveryJobReceipt = Readonly<{
  jobId: string
  organizationId: string
  created: boolean
}>

export type InvitationDurableJobInput = Readonly<{
  organizationId: string
  kind: typeof ORGANIZATION_INVITATION_DELIVERY_JOB_KIND
  payload: InvitationDeliveryJobPayload
  maxAttempts: number
  idempotencyKey: string
}>

export type InvitationDurableJobRecord = Readonly<{
  id: string
  organizationId: string
  siteId: string | null
  kind: string
}>

/** Narrow structural port implemented by FUMA-009's FumaJobService. */
export interface FumaInvitationDurableJobPort {
  enqueue(input: InvitationDurableJobInput): Promise<Readonly<{
    job: InvitationDurableJobRecord
    created: boolean
  }>>
}

export interface InvitationDeliveryJobPort {
  enqueue(input: unknown): Promise<InvitationDeliveryJobReceipt>
}

function deliveryIdempotencyKey(invitationId: string): string {
  const digest = createHash('sha256')
    .update(`organization-invitation-delivery\u0000${invitationId}`)
    .digest('hex')
  return `organization-invitation-delivery:${digest}`
}

export class FumaInvitationDeliveryJobs implements InvitationDeliveryJobPort {
  readonly #durableJobs: FumaInvitationDurableJobPort

  constructor(durableJobs: FumaInvitationDurableJobPort) {
    this.#durableJobs = durableJobs
  }

  async enqueue(input: unknown): Promise<InvitationDeliveryJobReceipt> {
    const parsed = safeParseValue(EnqueueInvitationDeliveryInputSchema, input)
    if (!parsed.ok) throw new TypeError('Invitation delivery job input failed validation.')

    const result = await this.#durableJobs.enqueue({
      organizationId: parsed.value.organizationId,
      kind: ORGANIZATION_INVITATION_DELIVERY_JOB_KIND,
      payload: { invitationId: parsed.value.invitationId },
      maxAttempts: 5,
      idempotencyKey: deliveryIdempotencyKey(parsed.value.invitationId),
    })
    if (
      result.job.organizationId !== parsed.value.organizationId
      || result.job.siteId !== null
      || result.job.kind !== ORGANIZATION_INVITATION_DELIVERY_JOB_KIND
    ) {
      throw new Error('FUMA-009 returned an invitation delivery job outside its organization scope.')
    }
    return {
      jobId: result.job.id,
      organizationId: result.job.organizationId,
      created: result.created,
    }
  }
}
