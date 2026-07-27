import { CapabilityOverridesSchema } from '@core/fuma'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import {
  SiteIdSchema,
  SiteOrganizationIdSchema,
  SiteProfileIdSchema,
  SiteRecordSchema,
  SiteWorkspaceIdSchema,
  type SiteRecord,
} from '../sites/contracts'

const REGISTRY_ID_OPTIONS = {
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
} as const

export const StarterTemplateIdSchema = Type.String(REGISTRY_ID_OPTIONS)
export type StarterTemplateId = Static<typeof StarterTemplateIdSchema>

export const StarterTemplateApplicationCommandSchema = Type.Object({
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  siteId: SiteIdSchema,
  templateIds: Type.Array(StarterTemplateIdSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type StarterTemplateApplicationCommand = Static<
  typeof StarterTemplateApplicationCommandSchema
>

export const StarterTemplateApplicationReceiptSchema = Type.Object({
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  siteId: SiteIdSchema,
  profileId: SiteProfileIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
  compositionFingerprint: Type.String({ minLength: 1 }),
  contributionId: StarterTemplateIdSchema,
  templateId: StarterTemplateIdSchema,
  appliedAt: Type.String({
    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
  }),
}, { additionalProperties: false })
export type StarterTemplateApplicationReceipt = Static<
  typeof StarterTemplateApplicationReceiptSchema
>

export const StarterTemplateApplicationResultSchema = Type.Object({
  site: SiteRecordSchema,
  receipts: Type.Array(StarterTemplateApplicationReceiptSchema),
  appliedTemplateIds: Type.Array(StarterTemplateIdSchema),
  replayedTemplateIds: Type.Array(StarterTemplateIdSchema),
}, { additionalProperties: false })
export type StarterTemplateApplicationResult = Static<
  typeof StarterTemplateApplicationResultSchema
>

export type StarterTemplateApplicationErrorCode =
  | 'invalid-command'
  | 'site-not-found'
  | 'site-drift'
  | 'profile-drift'
  | 'composition-drift'
  | 'unknown-template'
  | 'unavailable-template'
  | 'receipt-conflict'

export class StarterTemplateApplicationError extends Error {
  override readonly name = 'StarterTemplateApplicationError'
  readonly code: StarterTemplateApplicationErrorCode
  readonly siteId: string | undefined
  readonly templateId: string | undefined

  constructor(
    code: StarterTemplateApplicationErrorCode,
    message: string,
    options: { siteId?: string; templateId?: string } = {},
  ) {
    super(message)
    this.code = code
    this.siteId = options.siteId
    this.templateId = options.templateId
  }
}

export interface StarterTemplateEffectInput {
  organizationId: string
  workspaceId: string
  siteId: string
  profileId: string
  contributionId: string
  templateId: StarterTemplateId
}

/** A trusted implementation registered by exact template ID. */
export interface StarterTemplateApplier<EffectTransaction> {
  readonly templateId: StarterTemplateId
  apply(
    input: StarterTemplateEffectInput,
    transaction: EffectTransaction,
  ): Promise<void>
}

export interface StarterTemplateEffectOnceInput {
  expectedSite: SiteRecord
  receipt: StarterTemplateApplicationReceipt
}

export type StarterTemplateEffectOnceResult =
  | {
      status: 'applied' | 'replayed'
      receipt: StarterTemplateApplicationReceipt
    }
  | {
      status: 'site-drift'
      site: SiteRecord | null
    }

/**
 * Persistence boundary for starter setup.
 *
 * `runTemplateEffectOnce` must lock the site and its `(siteId, templateId)`
 * idempotency key, compare the current site with `expectedSite`, then execute
 * `effect` and insert `receipt` in one transaction. The supplied effect
 * transaction must write through that same transaction. Effect and receipt
 * both commit, or both roll back. A unique per-site/template receipt makes
 * concurrent and replayed calls return `replayed` without executing `effect`.
 */
export interface StarterTemplateApplicationRepository<EffectTransaction> {
  getOwnedSite(
    organizationId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<SiteRecord | null>

  runTemplateEffectOnce(
    input: StarterTemplateEffectOnceInput,
    effect: (transaction: EffectTransaction) => Promise<void>,
  ): Promise<StarterTemplateEffectOnceResult>
}
