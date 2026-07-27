import { apiRequest, type FetchLike } from '@core/http'
import {
  NewsletterAudienceEstimateSchema,
  NewsletterComposerDraftSchema,
  NewsletterDetailResponseSchema,
  NewsletterIdCommandSchema,
  NewsletterListResponseSchema,
  NewsletterSendReadinessSchema,
  type NewsletterAudienceEstimate,
  type NewsletterAudienceQuery,
  type NewsletterComposerDraft,
  type NewsletterDraftAutosaveCommand,
  type NewsletterProfileCommand,
  type NewsletterSenderVerification,
  type NewsletterSendReadiness,
  type PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { PublicationClientTarget } from './client'

const TargetSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
  profileId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

export type NewsletterComposerDetail = Readonly<{
  newsletter: PublicationNewsletterProfile
  draft: NewsletterComposerDraft | null
  settings: ResolvedEmailSettingsV2
  senderVerification: NewsletterSenderVerification | null
}>

export class NewsletterComposerHttpClient {
  readonly target: PublicationClientTarget
  readonly #fetch: FetchLike
  readonly #base: string

  constructor(target: PublicationClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    const parsed = safeParseValue(TargetSchema, target)
    if (!parsed.ok) throw new TypeError('Newsletter composer client target is invalid.')
    this.target = Object.freeze(structuredClone(parsed.value))
    this.#fetch = fetchImpl
    this.#base = `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/publication/newsletter-composer`
  }

  #request<T extends TSchema>(method: string, suffix: string, schema: T, body?: unknown): Promise<Static<T>> {
    return apiRequest(`${this.#base}${suffix}`, {
      method,
      body,
      schema,
      fetchImpl: this.#fetch,
      fallbackMessage: 'Newsletter composer request failed',
    })
  }

  async list(): Promise<readonly PublicationNewsletterProfile[]> {
    return (await this.#request('GET', '', NewsletterListResponseSchema)).newsletters
  }

  detail(newsletterId: string): Promise<NewsletterComposerDetail> {
    return this.#request('GET', `/${encodeURIComponent(newsletterId)}`, NewsletterDetailResponseSchema)
  }

  saveProfile(command: NewsletterProfileCommand): Promise<PublicationNewsletterProfile> {
    return this.#request('POST', '/profile', NewsletterDetailResponseSchema.properties.newsletter, command)
  }

  autosave(command: NewsletterDraftAutosaveCommand): Promise<NewsletterComposerDraft> {
    return this.#request('POST', '/autosave', NewsletterComposerDraftSchema, command)
  }

  estimate(newsletterId: string, audience: NewsletterAudienceQuery): Promise<NewsletterAudienceEstimate> {
    return this.#request('POST', '/audience-estimate', NewsletterAudienceEstimateSchema, {
      newsletterId,
      audience: { ...audience, segmentIds: [...audience.segmentIds] },
    })
  }

  readiness(newsletterId: string): Promise<NewsletterSendReadiness> {
    const command: Static<typeof NewsletterIdCommandSchema> = { newsletterId }
    return this.#request('POST', '/send-readiness', NewsletterSendReadinessSchema, command)
  }
}
