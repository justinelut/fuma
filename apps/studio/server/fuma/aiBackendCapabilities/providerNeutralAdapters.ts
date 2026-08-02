import type { Static } from '@core/utils/typeboxHelpers'
import type { PublicationContent, PublicationVisibility } from '@core/fuma/publication'
import type { PublicationRepositoryScope } from '../publication/scope'
import type { PublicationDomainStore } from '../publication/servicePorts'
import type {
  PublicationEditorialService,
  PublicationIdentityService,
} from '../publication/services'
import type { PublicationMemberAccessService } from '../publication/memberAccess'
import type { PublicationPrivacyAnalyticsService } from '../publication/privacyAnalytics'
import type { TrustedBackendCapabilityAuthority } from './contracts'
import {
  EvaluatePublicationAccessOutputSchema,
  GetPublicationContentOutputSchema,
  GetPublicationSettingsOutputSchema,
  ListNewslettersOutputSchema,
  ListPublicationContentOutputSchema,
  ListPublicationTaxonomyOutputSchema,
  PublicationAnalyticsReportOutputSchema,
  RequestPublicationOutputSchema,
  SavePublicationDraftOutputSchema,
  type EvaluatePublicationAccessInput,
  type ListPublicationContentInput,
  type PublicationAnalyticsReportInput,
  type ProviderNeutralContentView,
  type RequestPublicationInput,
  type SavePublicationDraftInput,
} from './providerNeutralContracts'
import { parseBackendCapability } from './contracts'

export type ProviderNeutralExecutionContext = Readonly<{
  authority: TrustedBackendCapabilityAuthority
  signal: AbortSignal
}>

export interface ProviderNeutralPublicationAuthority {
  listContent(input: ListPublicationContentInput, context: ProviderNeutralExecutionContext): Promise<Static<typeof ListPublicationContentOutputSchema>>
  getContent(contentId: string, context: ProviderNeutralExecutionContext): Promise<Static<typeof GetPublicationContentOutputSchema>>
  saveDraft(input: SavePublicationDraftInput, context: ProviderNeutralExecutionContext): Promise<Static<typeof SavePublicationDraftOutputSchema>>
  requestPublication(input: RequestPublicationInput, context: ProviderNeutralExecutionContext): Promise<Static<typeof RequestPublicationOutputSchema>>
  listTaxonomy(context: ProviderNeutralExecutionContext): Promise<Static<typeof ListPublicationTaxonomyOutputSchema>>
  getSettings(context: ProviderNeutralExecutionContext): Promise<Static<typeof GetPublicationSettingsOutputSchema>>
  listNewsletters(limit: number, context: ProviderNeutralExecutionContext): Promise<Static<typeof ListNewslettersOutputSchema>>
  evaluateAccess(input: EvaluatePublicationAccessInput, context: ProviderNeutralExecutionContext): Promise<Static<typeof EvaluatePublicationAccessOutputSchema>>
  analyticsReport(input: PublicationAnalyticsReportInput, context: ProviderNeutralExecutionContext): Promise<Static<typeof PublicationAnalyticsReportOutputSchema>>
}

/** Replaceable standalone-export seam. Implementations call an owner's backend, never private Fuma modules. */
export interface ProviderNeutralPublicationExportAdapter {
  listContent(input: ListPublicationContentInput, signal?: AbortSignal): Promise<Static<typeof ListPublicationContentOutputSchema>>
  getContent(input: Readonly<{ contentId: string }>, signal?: AbortSignal): Promise<Static<typeof GetPublicationContentOutputSchema>>
  saveDraft(input: SavePublicationDraftInput, signal?: AbortSignal): Promise<Static<typeof SavePublicationDraftOutputSchema>>
  requestPublication(input: RequestPublicationInput, confirmationToken: string, signal?: AbortSignal): Promise<Static<typeof RequestPublicationOutputSchema>>
  listTaxonomy(signal?: AbortSignal): Promise<Static<typeof ListPublicationTaxonomyOutputSchema>>
  getSettings(signal?: AbortSignal): Promise<Static<typeof GetPublicationSettingsOutputSchema>>
  listNewsletters(input: Readonly<{ limit: number }>, signal?: AbortSignal): Promise<Static<typeof ListNewslettersOutputSchema>>
  evaluateAccess(input: EvaluatePublicationAccessInput, signal?: AbortSignal): Promise<Static<typeof EvaluatePublicationAccessOutputSchema>>
  analyticsReport(input: PublicationAnalyticsReportInput, signal?: AbortSignal): Promise<Static<typeof PublicationAnalyticsReportOutputSchema>>
}

export type CanonicalProviderNeutralPublicationPorts = Readonly<{
  store: Pick<PublicationDomainStore,
    'listContent' | 'getContent' | 'listAuthors' | 'listTags' | 'listNewsletters'>
  editorial: Pick<PublicationEditorialService, 'save' | 'transition'>
  identity: Pick<PublicationIdentityService, 'get'>
  memberAccess: Pick<PublicationMemberAccessService, 'evaluate'>
  privacyAnalytics: Pick<PublicationPrivacyAnalyticsService, 'report'>
  now?: () => Date
}>

function publicationScope(authority: TrustedBackendCapabilityAuthority): PublicationRepositoryScope {
  const scope = authority.scope
  return Object.freeze({
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    generation: scope.ownerGeneration,
    state: 'active',
    transferFence: null,
    profileId: scope.profileId,
  })
}

function body(document: unknown): ProviderNeutralContentView['body'] {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null
  const value = document as Record<string, unknown>
  if ((value.format === 'plain-text' || value.format === 'markdown' || value.format === 'html')
    && typeof value.value === 'string' && value.value.length <= 262_144
    && Object.keys(value).every((key) => key === 'format' || key === 'value')) {
    return { format: value.format, value: value.value }
  }
  return null
}

function projectedVisibility(value: PublicationVisibility): ProviderNeutralContentView['visibility'] {
  return value.kind === 'segment'
    ? { kind: 'segment', segmentIds: [...value.segmentIds] }
    : { kind: value.kind }
}

function view(content: PublicationContent): ProviderNeutralContentView {
  return {
    contentId: content.contentId,
    kind: content.kind,
    title: content.metadata.title,
    slug: content.metadata.slug,
    excerpt: content.metadata.excerpt,
    body: body(content.document),
    status: content.status,
    workflowVersion: content.workflowVersion,
    canonicalUrl: content.metadata.canonicalUrl,
    redirects: content.metadata.redirects.map((redirect) => ({ ...redirect })),
    openGraph: structuredClone(content.metadata.openGraph),
    social: structuredClone(content.metadata.social),
    seoTitle: content.metadata.seoTitle,
    seoDescription: content.metadata.seoDescription,
    featureImageId: content.metadata.featureImageId,
    tagIds: [...content.metadata.tagIds],
    primaryTagId: content.metadata.primaryTagId,
    authorIds: [...content.metadata.authorIds],
    visibility: projectedVisibility(content.metadata.visibility),
    scheduledAt: content.scheduledAt,
    publishedAt: content.publishedAt,
    updatedAt: content.updatedAt,
  }
}

function checked<T>(schema: Parameters<typeof parseBackendCapability>[0], value: T, boundary: string): T {
  return parseBackendCapability(schema, value, boundary) as T
}

/** Thin adapter over the canonical Publication graph; it owns no repository or persistence. */
export class CanonicalProviderNeutralPublicationAdapter implements ProviderNeutralPublicationAuthority {
  readonly #ports: CanonicalProviderNeutralPublicationPorts
  readonly #now: () => Date

  constructor(ports: CanonicalProviderNeutralPublicationPorts) {
    this.#ports = ports
    this.#now = ports.now ?? (() => new Date())
  }

  async listContent(input: ListPublicationContentInput, context: ProviderNeutralExecutionContext) {
    const query = input.query.trim().toLowerCase()
    const candidates = (await this.#ports.store.listContent(publicationScope(context.authority)))
      .filter((item) => input.kind === 'all' || item.kind === input.kind)
      .filter((item) => input.status === 'all' || item.status === input.status)
      .filter((item) => !query || `${item.metadata.title}\n${item.metadata.slug}\n${item.metadata.excerpt}`.toLowerCase().includes(query))
      .toSorted((left, right) => left.contentId.localeCompare(right.contentId))
      .filter((item) => input.afterId === null || item.contentId > input.afterId)
    const page = candidates.slice(0, input.limit)
    return checked(ListPublicationContentOutputSchema, {
      items: page.map(view),
      nextAfterId: candidates.length > page.length ? page.at(-1)?.contentId ?? null : null,
    }, 'providerNeutral.listContent.output')
  }

  async getContent(contentId: string, context: ProviderNeutralExecutionContext) {
    const item = await this.#ports.store.getContent(publicationScope(context.authority), contentId)
    return checked(GetPublicationContentOutputSchema, { item: item ? view(item) : null }, 'providerNeutral.getContent.output')
  }

  async saveDraft(input: SavePublicationDraftInput, context: ProviderNeutralExecutionContext) {
    const scope = publicationScope(context.authority)
    const current = await this.#ports.store.getContent(scope, input.contentId)
    if ((input.expectedVersion === null) !== (current === null)) throw new Error('Exact content version authority is unavailable.')
    if (current && (current.kind !== input.kind || current.workflowVersion !== input.expectedVersion)) {
      throw new Error('Exact content version authority is unavailable.')
    }
    const at = this.#now().toISOString()
    const visibility: PublicationVisibility = input.visibility.kind === 'segment'
      ? { kind: 'segment', segmentIds: [...input.visibility.segmentIds] }
      : { kind: input.visibility.kind }
    const content: PublicationContent = {
      contentId: input.contentId,
      kind: input.kind,
      metadata: {
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt,
        canonicalUrl: input.canonicalUrl,
        redirects: structuredClone(input.redirects),
        openGraph: structuredClone(input.openGraph),
        social: structuredClone(input.social),
        visibility,
        featureImageId: input.featureImageId,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        tagIds: [...input.tagIds],
        primaryTagId: input.primaryTagId,
        authorIds: [...input.authorIds],
      },
      document: structuredClone(input.body),
      status: current?.status ?? 'draft',
      workflowVersion: current?.workflowVersion ?? 1,
      scheduledAt: current?.scheduledAt ?? null,
      publishedAt: current?.publishedAt ?? null,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    }
    const saved = await this.#ports.editorial.save(scope, content, input.expectedVersion)
    return checked(SavePublicationDraftOutputSchema, { item: view(saved) }, 'providerNeutral.saveDraft.output')
  }

  async requestPublication(input: RequestPublicationInput, context: ProviderNeutralExecutionContext) {
    const saved = await this.#ports.editorial.transition(publicationScope(context.authority), {
      transitionId: context.authority.operationId,
      contentId: input.contentId,
      from: input.from,
      to: input.to,
      actorId: context.authority.actor.actorId,
      expectedVersion: input.expectedVersion,
      scheduledAt: input.scheduledAt,
      note: input.note,
      createdAt: this.#now().toISOString(),
    })
    return checked(RequestPublicationOutputSchema, { item: view(saved) }, 'providerNeutral.requestPublication.output')
  }

  async listTaxonomy(context: ProviderNeutralExecutionContext) {
    const scope = publicationScope(context.authority)
    const [authors, tags] = await Promise.all([this.#ports.store.listAuthors(scope), this.#ports.store.listTags(scope)])
    return checked(ListPublicationTaxonomyOutputSchema, {
      authors: authors.slice(0, 500).map(({ authorId, displayName, image }) => ({ authorId, displayName, image })),
      tags: tags.slice(0, 500),
    }, 'providerNeutral.listTaxonomy.output')
  }

  async getSettings(context: ProviderNeutralExecutionContext) {
    return checked(GetPublicationSettingsOutputSchema, {
      settings: await this.#ports.identity.get(publicationScope(context.authority)),
    }, 'providerNeutral.getSettings.output')
  }

  async listNewsletters(limit: number, context: ProviderNeutralExecutionContext) {
    const newsletters = await this.#ports.store.listNewsletters(publicationScope(context.authority))
    return checked(ListNewslettersOutputSchema, { items: newsletters.slice(0, limit).map((item) => ({
      newsletterId: item.newsletterId,
      name: item.name,
      slug: item.slug,
      description: item.description,
      status: item.status,
      defaultSegmentId: item.defaultSegmentId,
      updatedAt: item.updatedAt,
    })) }, 'providerNeutral.listNewsletters.output')
  }

  async evaluateAccess(input: EvaluatePublicationAccessInput, context: ProviderNeutralExecutionContext) {
    const evaluation = await this.#ports.memberAccess.evaluate(publicationScope(context.authority), {
      memberIdentityId: context.authority.actor.kind === 'member' ? context.authority.actor.actorId : null,
      ...input,
      evaluatedAt: this.#now().toISOString(),
    })
    return checked(EvaluatePublicationAccessOutputSchema, {
      member: evaluation.member,
      paid: evaluation.paid,
      accessState: evaluation.accessState,
      delivery: evaluation.presentation.delivery,
      statusCode: evaluation.presentation.statusCode,
      reason: evaluation.presentation.reason,
    }, 'providerNeutral.evaluateAccess.output')
  }

  async analyticsReport(input: PublicationAnalyticsReportInput, context: ProviderNeutralExecutionContext) {
    const report = await this.#ports.privacyAnalytics.report(publicationScope(context.authority), input)
    return checked(PublicationAnalyticsReportOutputSchema, report.totals, 'providerNeutral.analyticsReport.output')
  }
}
