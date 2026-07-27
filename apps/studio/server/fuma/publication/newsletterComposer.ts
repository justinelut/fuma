import {
  NewsletterComposerDraftSchema,
  NewsletterComposerPreviewSchema,
  NewsletterDraftAutosaveCommandSchema,
  NewsletterProfileCommandSchema,
  NewsletterSenderVerificationSchema,
  NewsletterSendReadinessSchema,
  PublicationNewsletterProfileSchema,
  parseNewsletterComposerContract,
  type NewsletterAudienceEstimate,
  type NewsletterAudienceQuery,
  type NewsletterComposerDraft,
  type NewsletterComposerPreview,
  type NewsletterDraftAutosaveCommand,
  type NewsletterProfileCommand,
  type NewsletterSenderVerification,
  type NewsletterSendReadiness,
  type PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import { renderEmailDocument } from '../email'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationDomainStore, PublicationIdAuthority } from './servicePorts'
import type { HierarchicalEmailSettingsService } from './emailSettings'

export type NewsletterDraftSaveResult =
  | Readonly<{ kind: 'saved' | 'replayed'; draft: NewsletterComposerDraft }>
  | Readonly<{ kind: 'conflict'; draft: NewsletterComposerDraft | null }>

export interface NewsletterComposerRepository {
  list(scope: PublicationRepositoryScope, limit: number): Promise<readonly PublicationNewsletterProfile[]>
  get(scope: PublicationRepositoryScope, newsletterId: string): Promise<PublicationNewsletterProfile | null>
  put(scope: PublicationRepositoryScope, newsletter: PublicationNewsletterProfile, expectedVersion: number | null): Promise<boolean>
  getDraft(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterComposerDraft | null>
  saveDraft(scope: PublicationRepositoryScope, draft: NewsletterComposerDraft, expectedSequence: number, mutationId: string, commandSha256: string): Promise<NewsletterDraftSaveResult>
  getSenderVerification(scope: PublicationRepositoryScope, senderEmail: string): Promise<NewsletterSenderVerification | null>
  recordSenderVerification(scope: PublicationRepositoryScope, verification: NewsletterSenderVerification): Promise<boolean>
}

export interface NewsletterAudienceAuthority {
  segmentExists(scope: PublicationRepositoryScope, segmentId: string): Promise<boolean>
  estimate(scope: PublicationRepositoryScope, newsletterId: string, audience: NewsletterAudienceQuery): Promise<NewsletterAudienceEstimate>
}

export class NewsletterComposerError extends Error {
  readonly code: 'conflict' | 'not-found' | 'invalid-link' | 'sender-unverified' | 'audience-incomplete'
  constructor(code: NewsletterComposerError['code'], message: string) {
    super(message)
    this.name = 'NewsletterComposerError'
    this.code = code
  }
}

export class NewsletterComposerService {
  readonly #repository: NewsletterComposerRepository
  readonly #content: Pick<PublicationDomainStore, 'getContent'>
  readonly #settings: Pick<HierarchicalEmailSettingsService, 'resolve'>
  readonly #audience: NewsletterAudienceAuthority
  readonly #ids: PublicationIdAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{
    repository: NewsletterComposerRepository
    content: Pick<PublicationDomainStore, 'getContent'>
    settings: Pick<HierarchicalEmailSettingsService, 'resolve'>
    audience: NewsletterAudienceAuthority
    ids: PublicationIdAuthority
    now?: () => Date
  }>) {
    this.#repository = input.repository
    this.#content = input.content
    this.#settings = input.settings
    this.#audience = input.audience
    this.#ids = input.ids
    this.#now = input.now ?? (() => new Date())
  }

  list(scope: PublicationRepositoryScope): Promise<readonly PublicationNewsletterProfile[]> {
    return this.#repository.list(scope, 200)
  }

  async detail(scope: PublicationRepositoryScope, newsletterId: string) {
    const newsletter = await this.#requiredNewsletter(scope, newsletterId)
    const settings = await this.#settings.resolve(scope, newsletter.newsletterId)
    return Object.freeze({
      newsletter,
      draft: await this.#repository.getDraft(scope, newsletter.newsletterId),
      settings,
      senderVerification: await this.#repository.getSenderVerification(scope, settings.values.senderEmail),
    })
  }

  async saveProfile(scope: PublicationRepositoryScope, actorId: string, input: NewsletterProfileCommand): Promise<PublicationNewsletterProfile> {
    const command = parseNewsletterComposerContract('Newsletter profile command', NewsletterProfileCommandSchema, input)
    const current = await this.#repository.get(scope, command.newsletterId)
    if ((current?.version ?? null) !== command.expectedVersion) throw new NewsletterComposerError('conflict', 'Newsletter profile changed concurrently.')
    if (command.defaultSegmentId !== null && !await this.#audience.segmentExists(scope, command.defaultSegmentId)) {
      throw new NewsletterComposerError('not-found', 'Newsletter segment was not found.')
    }
    if (command.webContentId !== null) await this.#linkedContent(scope, command.webContentId)
    const now = this.#now().toISOString()
    const newsletter = parseNewsletterComposerContract('Newsletter profile', PublicationNewsletterProfileSchema, {
      newsletterId: command.newsletterId,
      name: command.name,
      slug: command.slug,
      description: command.description,
      status: command.status,
      defaultSegmentId: command.defaultSegmentId,
      webContentId: command.webContentId,
      version: (current?.version ?? 0) + 1,
      createdBy: current?.createdBy ?? actorId,
      createdAt: current?.createdAt ?? now,
      updatedBy: actorId,
      updatedAt: now,
    })
    if (!await this.#repository.put(scope, newsletter, command.expectedVersion)) throw new NewsletterComposerError('conflict', 'Newsletter profile changed concurrently.')
    return newsletter
  }

  async autosave(scope: PublicationRepositoryScope, actorId: string, input: NewsletterDraftAutosaveCommand): Promise<NewsletterComposerDraft> {
    const command = parseNewsletterComposerContract('Newsletter draft autosave command', NewsletterDraftAutosaveCommandSchema, input)
    await this.#requiredNewsletter(scope, command.newsletterId)
    const current = await this.#repository.getDraft(scope, command.newsletterId)
    if (current === null) {
      if (command.expectedSequence !== 0 || command.draftId !== null) throw new NewsletterComposerError('conflict', 'Newsletter draft changed concurrently.')
    } else if (command.draftId !== current.draftId && command.draftId !== null) {
      throw new NewsletterComposerError('conflict', 'Newsletter draft identity cannot change.')
    }
    const draft = parseNewsletterComposerContract('Newsletter composer draft', NewsletterComposerDraftSchema, {
      draftId: current?.draftId ?? this.#ids.id('newsletter-draft'),
      newsletterId: command.newsletterId,
      sequence: command.expectedSequence + 1,
      subject: command.subject,
      previewText: command.previewText,
      document: command.document,
      audience: command.audience,
      updatedBy: actorId,
      updatedAt: this.#now().toISOString(),
    })
    const commandSha256 = this.#ids.sha256(canonicalJson({ ...command, mutationId: undefined }))
    const result = await this.#repository.saveDraft(scope, draft, command.expectedSequence, command.mutationId, commandSha256)
    if (result.kind === 'conflict') throw new NewsletterComposerError('conflict', 'Newsletter draft changed concurrently; reload before merging edits.')
    return result.draft
  }

  async estimate(scope: PublicationRepositoryScope, newsletterId: string, audience: NewsletterAudienceQuery): Promise<NewsletterAudienceEstimate> {
    await this.#requiredNewsletter(scope, newsletterId)
    return await this.#audience.estimate(scope, newsletterId, audience)
  }

  async preview(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterComposerPreview> {
    await this.#requiredNewsletter(scope, newsletterId)
    const draft = await this.#requiredDraft(scope, newsletterId)
    const [settings, rendered] = await Promise.all([
      this.#settings.resolve(scope, newsletterId),
      renderEmailDocument(draft.document),
    ])
    return parseNewsletterComposerContract('Newsletter composer preview', NewsletterComposerPreviewSchema, {
      newsletterId,
      draftId: draft.draftId,
      sequence: draft.sequence,
      subject: draft.subject,
      html: rendered.html,
      text: rendered.text,
      settings,
    })
  }

  async sendReadiness(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterSendReadiness> {
    const newsletter = await this.#requiredNewsletter(scope, newsletterId)
    const draft = await this.#requiredDraft(scope, newsletterId)
    const [settings, audienceEstimate] = await Promise.all([
      this.#settings.resolve(scope, newsletterId),
      this.#audience.estimate(scope, newsletterId, draft.audience),
      renderEmailDocument(draft.document),
    ])
    const senderVerification = await this.#repository.getSenderVerification(scope, settings.values.senderEmail)
    const reasons: NewsletterSendReadiness['reasons'][number][] = []
    if (newsletter.status !== 'active') reasons.push('newsletter-not-active')
    if (!verifiedSender(settings, senderVerification)) reasons.push('sender-not-verified')
    if (audienceEstimate.countKind === 'lower-bound') reasons.push('audience-estimate-capped')
    if (audienceEstimate.estimatedSubscribed === 0) reasons.push('audience-empty')
    if (newsletter.webContentId !== null && (await this.#linkedContent(scope, newsletter.webContentId)).status !== 'published') reasons.push('linked-web-content-unpublished')
    return parseNewsletterComposerContract('Newsletter send readiness', NewsletterSendReadinessSchema, {
      newsletter,
      draft,
      settings,
      senderVerification,
      audienceEstimate,
      canSend: reasons.length === 0,
      reasons,
    })
  }

  async assertSendAllowed(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterSendReadiness> {
    const readiness = await this.sendReadiness(scope, newsletterId)
    if (!readiness.canSend) {
      const code = readiness.reasons.includes('sender-not-verified') ? 'sender-unverified' : 'audience-incomplete'
      throw new NewsletterComposerError(code, 'Newsletter is not ready to send.')
    }
    return readiness
  }

  async #requiredNewsletter(scope: PublicationRepositoryScope, newsletterId: string): Promise<PublicationNewsletterProfile> {
    const newsletter = await this.#repository.get(scope, newsletterId)
    if (!newsletter) throw new NewsletterComposerError('not-found', 'Newsletter was not found.')
    return newsletter
  }

  async #requiredDraft(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterComposerDraft> {
    const draft = await this.#repository.getDraft(scope, newsletterId)
    if (!draft) throw new NewsletterComposerError('not-found', 'Newsletter draft was not found.')
    return draft
  }

  async #linkedContent(scope: PublicationRepositoryScope, contentId: string) {
    const content = await this.#content.getContent(scope, contentId)
    if (!content) throw new NewsletterComposerError('invalid-link', 'Linked web content was not found in the current universal content scope.')
    return content
  }
}

function verifiedSender(settings: ResolvedEmailSettingsV2, verification: NewsletterSenderVerification | null): boolean {
  return verification?.state === 'verified'
    && verification.verifiedAt !== null
    && verification.senderEmail.toLowerCase() === settings.values.senderEmail.toLowerCase()
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function parseTrustedSenderVerification(value: unknown): NewsletterSenderVerification {
  return parseNewsletterComposerContract('Trusted sender verification', NewsletterSenderVerificationSchema, value)
}
