import type { QuotaService } from './service'

export type CampaignQuotaScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export interface CampaignQuotaAuthority {
  reserve(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
    recipients: number,
  ): Promise<void>
  settle(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
    attemptedRecipients: number,
  ): Promise<void>
  release(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
  ): Promise<void>
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`)
  return value
}

function key(scope: CampaignQuotaScope, campaignId: string, snapshotSha256: string): string {
  return `campaign-quota:${scope.organizationId}:${campaignId}:${snapshotSha256}`
}

/** Atomically reserves both campaign recipient windows before any OCI submission. */
export class QuotaCampaignAuthority implements CampaignQuotaAuthority {
  readonly #quota: QuotaService

  constructor(quota: QuotaService) {
    this.#quota = quota
  }

  async reserve(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
    recipients: number,
  ): Promise<void> {
    count(recipients, 'Campaign recipients')
    if (recipients === 0) return
    await this.#quota.reserve({
      idempotencyKey: key(scope, campaignId, snapshotSha256),
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
      operation: 'campaign',
      items: [
        { quotaClass: 'emailRecipientsDay', units: recipients },
        { quotaClass: 'emailRecipientsMonth', units: recipients },
      ],
    })
  }

  async settle(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
    attemptedRecipients: number,
  ): Promise<void> {
    count(attemptedRecipients, 'Attempted campaign recipients')
    const idempotencyKey = key(scope, campaignId, snapshotSha256)
    try {
      await this.#quota.settleReservation({
        idempotencyKey,
        actual: [
          { quotaClass: 'emailRecipientsDay', units: attemptedRecipients },
          { quotaClass: 'emailRecipientsMonth', units: attemptedRecipients },
        ],
      })
    } catch (error) {
      if (attemptedRecipients === 0
        && error instanceof Error
        && error.message === 'Quota reservation does not exist.') return
      throw error
    }
  }

  async release(
    scope: CampaignQuotaScope,
    campaignId: string,
    snapshotSha256: string,
  ): Promise<void> {
    try {
      await this.#quota.releaseReservation(key(scope, campaignId, snapshotSha256))
    } catch (error) {
      if (error instanceof Error && error.message === 'Quota reservation does not exist.') return
      throw error
    }
  }
}
