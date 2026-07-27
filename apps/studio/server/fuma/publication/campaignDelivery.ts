import {
  CampaignProgressSchema,
  CampaignSnapshotSchema,
  parsePublicationContract,
  type CampaignDelivery,
  type CampaignProgress,
  type CampaignSnapshot,
} from '@core/fuma/publication'
import type { FumaJobService } from '../jobs'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationDeliverabilityControlService } from './deliverability'
import type {
  OciEmailDeliveryProvider,
  PublicationDomainStore,
  PublicationIdAuthority,
  PublicationUnsubscribeLinkIssuer,
} from './servicePorts'
import {
  PublicationDomainError,
  canonicalPublicationJson,
  type PublicationAudienceService,
  type PublicationNewsletterService,
} from './services'

export const MAX_CAMPAIGN_MESSAGE_BYTES = 2 * 1024 * 1024

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function deliveryCount(deliveries: readonly CampaignDelivery[], status: CampaignDelivery['status']): number {
  return deliveries.filter((delivery) => delivery.status === status).length
}

export class PublicationCampaignService {
  readonly #store: PublicationDomainStore
  readonly #audience: PublicationAudienceService
  readonly #newsletters: PublicationNewsletterService
  readonly #ids: PublicationIdAuthority
  readonly #jobs: FumaJobService | null
  readonly #oci: OciEmailDeliveryProvider
  readonly #unsubscribe: PublicationUnsubscribeLinkIssuer | null
  readonly #deliverabilityControls: PublicationDeliverabilityControlService | null
  readonly #now: () => Date
  readonly #maxMessageBytes: number

  constructor(input: Readonly<{
    store: PublicationDomainStore
    audience: PublicationAudienceService
    newsletters: PublicationNewsletterService
    ids: PublicationIdAuthority
    jobs?: FumaJobService
    oci: OciEmailDeliveryProvider
    unsubscribe?: PublicationUnsubscribeLinkIssuer
    deliverabilityControls?: PublicationDeliverabilityControlService
    now?: () => Date
    maxMessageBytes?: number
  }>) {
    if (input.oci.kind !== 'oci-email-delivery') throw new TypeError('Launch campaign provider must be OCI Email Delivery.')
    const maxMessageBytes = input.maxMessageBytes ?? MAX_CAMPAIGN_MESSAGE_BYTES
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1 || maxMessageBytes > MAX_CAMPAIGN_MESSAGE_BYTES) {
      throw new TypeError('Campaign message limit must be a positive integer no greater than 2MB.')
    }
    this.#store = input.store
    this.#audience = input.audience
    this.#newsletters = input.newsletters
    this.#ids = input.ids
    this.#jobs = input.jobs ?? null
    this.#oci = input.oci
    this.#unsubscribe = input.unsubscribe ?? null
    this.#deliverabilityControls = input.deliverabilityControls ?? null
    this.#now = input.now ?? (() => new Date())
    this.#maxMessageBytes = maxMessageBytes
  }

  async snapshot(scope: PublicationRepositoryScope, command: Readonly<{
    campaignId: string
    newsletterId: string
    versionId: string
    segmentId: string
    scheduledAt: string | null
  }>): Promise<CampaignSnapshot> {
    const version = await this.#newsletters.version(scope, command.versionId)
    if (version.newsletterId !== command.newsletterId) throw new PublicationDomainError('conflict', 'Campaign newsletter and immutable version do not match.')
    const members = await this.#audience.resolveSegment(scope, command.segmentId)
    const preview = await this.#newsletters.preview(scope, command.versionId)
    if (this.#deliverabilityControls) await this.#deliverabilityControls.assertProductionSender(scope, preview.settings.values.senderEmail)
    const createdAt = this.#now().toISOString()
    if (command.scheduledAt !== null && Date.parse(command.scheduledAt) <= Date.parse(createdAt)) {
      throw new PublicationDomainError('invalid-transition', 'Scheduled campaigns require a future run time.')
    }
    const audience = members
      .map(({ memberId, email }) => ({ memberId, email: email.trim().toLowerCase() }))
      .toSorted((left, right) => left.memberId.localeCompare(right.memberId))
    const audienceMemberIds = audience.map(({ memberId }) => memberId)
    const audienceSha256 = this.#ids.sha256(canonicalPublicationJson(audience))
    const contentSha256 = this.#ids.sha256(canonicalPublicationJson({
      versionId: version.versionId,
      subject: preview.resolvedSubject,
      html: preview.html,
      text: preview.text,
      sender: preview.settings,
    }))
    const messageSizeBytes = Math.max(1, ...audience.map(({ email }) => encodedBytes({
      recipient: email,
      sender: preview.settings.values,
      subject: preview.resolvedSubject,
      html: preview.html,
      text: preview.text,
      headers: { campaignId: command.campaignId },
    })))
    if (messageSizeBytes > this.#maxMessageBytes) {
      throw new PublicationDomainError('payload-too-large', 'Campaign message exceeds the configured 2MB limit.')
    }
    const immutableSnapshot = {
      campaignId: command.campaignId,
      newsletterId: command.newsletterId,
      versionId: command.versionId,
      segmentId: command.segmentId,
      audienceMemberIds,
      subject: preview.resolvedSubject,
      html: preview.html,
      text: preview.text,
      sender: preview.settings,
      audienceSha256,
      contentSha256,
      messageSizeBytes,
      scheduledAt: command.scheduledAt,
      createdAt,
    }
    const snapshot = parsePublicationContract('campaign snapshot', CampaignSnapshotSchema, {
      ...immutableSnapshot,
      status: command.scheduledAt ? 'scheduled' : 'draft',
      snapshotSha256: this.#ids.sha256(canonicalPublicationJson(immutableSnapshot)),
    })
    const deliveries: CampaignDelivery[] = audience.map((member) => ({
      deliveryId: this.#ids.id('delivery'),
      campaignId: snapshot.campaignId,
      memberId: member.memberId,
      recipientEmail: member.email,
      status: 'queued',
      providerMessageId: null,
      attempt: 0,
      updatedAt: createdAt,
    }))
    if (!await this.#store.putCampaignWithDeliveries(scope, snapshot, deliveries)) {
      throw new PublicationDomainError('conflict', 'Campaign identity already exists.')
    }
    if (this.#jobs && snapshot.scheduledAt) {
      await this.#jobs.enqueue({
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        kind: 'publication.newsletter-send',
        payload: { campaignId: snapshot.campaignId, snapshotSha256: snapshot.snapshotSha256 },
        runAt: snapshot.scheduledAt,
        idempotencyKey: `campaign:${scope.ownerKey}:${scope.generation}:${snapshot.campaignId}:${snapshot.snapshotSha256}`,
      })
    }
    return snapshot
  }

  async cancel(scope: PublicationRepositoryScope, campaignId: string): Promise<CampaignSnapshot> {
    const campaign = await this.#store.getCampaign(scope, campaignId)
    if (!campaign) throw new PublicationDomainError('not-found', 'Campaign was not found.')
    if (campaign.status === 'cancelled') return campaign
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      throw new PublicationDomainError('invalid-transition', 'Only draft or scheduled campaigns can be cancelled.')
    }
    if (!await this.#store.transitionCampaignStatus(scope, campaignId, campaign.status, 'cancelled')) {
      throw new PublicationDomainError('conflict', 'Campaign state changed before cancellation.')
    }
    return { ...campaign, status: 'cancelled' }
  }

  async progress(scope: PublicationRepositoryScope, campaignId: string): Promise<CampaignProgress> {
    const campaign = await this.#store.getCampaign(scope, campaignId)
    if (!campaign) throw new PublicationDomainError('not-found', 'Campaign was not found.')
    const deliveries = await this.#store.listDeliveries(scope, campaignId)
    const queued = deliveryCount(deliveries, 'queued')
    const submitted = deliveryCount(deliveries, 'submitted')
    const delivered = deliveryCount(deliveries, 'delivered')
    const deferred = deliveryCount(deliveries, 'deferred')
    const bounced = deliveryCount(deliveries, 'bounced')
    const complained = deliveryCount(deliveries, 'complained')
    const suppressed = deliveryCount(deliveries, 'suppressed')
    const failed = deliveryCount(deliveries, 'failed')
    return parsePublicationContract('campaign progress', CampaignProgressSchema, {
      campaignId,
      status: campaign.status,
      recipientCount: deliveries.length,
      queued,
      submitted,
      delivered,
      deferred,
      bounced,
      complained,
      suppressed,
      failed,
      completed: submitted + delivered + bounced + complained + suppressed,
      audienceSha256: campaign.audienceSha256,
      contentSha256: campaign.contentSha256,
      snapshotSha256: campaign.snapshotSha256,
      messageSizeBytes: campaign.messageSizeBytes,
    })
  }

  async send(scope: PublicationRepositoryScope, campaignId: string, expectedSnapshotSha256?: string): Promise<readonly CampaignDelivery[]> {
    const campaign = await this.#store.getCampaign(scope, campaignId)
    if (!campaign) throw new PublicationDomainError('not-found', 'Campaign was not found.')
    if (expectedSnapshotSha256 !== undefined && campaign.snapshotSha256 !== expectedSnapshotSha256) {
      throw new PublicationDomainError('conflict', 'Campaign snapshot checksum changed.')
    }
    const current = await this.#store.listDeliveries(scope, campaignId)
    if (campaign.status === 'cancelled' || campaign.status === 'sent' || campaign.status === 'sending') return current
    let claimed = false
    for (const expected of ['draft', 'scheduled', 'failed'] as const) {
      if (await this.#store.transitionCampaignStatus(scope, campaignId, expected, 'sending')) {
        claimed = true
        break
      }
    }
    if (!claimed) return current
    const next: CampaignDelivery[] = []
    for (const delivery of current) {
      if (['submitted', 'delivered', 'bounced', 'complained', 'suppressed'].includes(delivery.status)) {
        next.push(delivery)
        continue
      }
      const updatedAt = this.#now().toISOString()
      const emailHash = this.#ids.sha256(delivery.recipientEmail.trim().toLowerCase())
      let result: CampaignDelivery
      const scopedSuppressed = this.#deliverabilityControls ? await this.#deliverabilityControls.isSuppressed(scope, delivery.recipientEmail, campaign.newsletterId) : false
      if (scopedSuppressed || await this.#store.isSuppressed(scope, emailHash)) {
        result = { ...delivery, status: 'suppressed', updatedAt }
      } else {
        try {
          const unsubscribeUrl = this.#unsubscribe
            ? await this.#unsubscribe.issue(scope, {
                memberId: delivery.memberId,
                newsletterId: campaign.newsletterId,
                recipientEmail: delivery.recipientEmail,
                issuedAt: updatedAt,
              })
            : null
          const providerInput = {
            idempotencyKey: `campaign:${campaign.snapshotSha256}:${delivery.memberId}`,
            recipient: delivery.recipientEmail,
            senderEmail: campaign.sender.values.senderEmail,
            senderName: campaign.sender.values.senderName,
            replyToEmail: campaign.sender.values.replyToEmail,
            subject: campaign.subject,
            html: campaign.html,
            text: campaign.text,
            headers: {
              'X-Fuma-Campaign': campaign.campaignId,
              ...(unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
            },
          } as const
          if (encodedBytes(providerInput) > this.#maxMessageBytes) throw new Error('Campaign provider envelope exceeds the configured 2MB limit.')
          const submission = await this.#oci.submit(providerInput)
          result = { ...delivery, status: 'submitted', providerMessageId: submission.providerMessageId, attempt: delivery.attempt + 1, updatedAt }
        } catch {
          result = { ...delivery, status: 'failed', attempt: delivery.attempt + 1, updatedAt }
        }
      }
      await this.#store.putDeliveries(scope, [result])
      next.push(result)
    }
    await this.#store.transitionCampaignStatus(scope, campaignId, 'sending', next.some((delivery) => delivery.status === 'failed') ? 'failed' : 'sent')
    return Object.freeze(next)
  }
}
