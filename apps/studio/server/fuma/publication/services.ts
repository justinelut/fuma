import {
  CampaignSnapshotSchema,
  EmailSettingsLayerSchema,
  NewsletterSchema,
  NewsletterTestSendCommandSchema,
  NewsletterVersionSchema,
  OciEmailProviderEventSchema,
  PublicationAccessGrantSchema,
  PublicationAnalyticsEventSchema,
  PublicationContentImportSchema,
  PublicationContentSchema,
  PublicationMemberSchema,
  PublicationReaderAccountSchema,
  PublicationSegmentSchema,
  PublicationSettingsSchema,
  PublicationTemplateSchema,
  PublicationWorkflowTransitionSchema,
  ResolvedEmailSettingsSchema,
  SuppressionSchema,
  UnsubscribeTokenClaimsSchema,
  parsePublicationContract,
  type CampaignDelivery,
  type CampaignSnapshot,
  type DeliverabilitySummary,
  type EmailSettingsLayer,
  type Newsletter,
  type NewsletterPreview,
  type NewsletterTestSendCommand,
  type NewsletterVersion,
  type OciEmailProviderEvent,
  type PublicationAccessGrant,
  type PublicationAnalyticsEvent,
  type PublicationAnalyticsSummary,
  type PublicationContent,
  type PublicationContentImport,
  type PublicationContentStatus,
  type PublicationMember,
  type PublicationReaderAccount,
  type PublicationSegment,
  type PublicationSettings,
  type PublicationTemplate,
  type PublicationWorkflowTransition,
  type ResolvedEmailSettings,
  type Suppression,
  type UnsubscribeTokenClaims,
} from '@core/fuma/publication'
import { renderEmailDocument } from '../email'
import { assertPublicationMetadataAuthority, replacePublicationAuthorityRecord } from './presentation'
import type { FumaJobService } from '../jobs'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationWorkflowService } from './editorialWorkflow'

import type {
  OciEmailDeliveryProvider,
  PublicationDomainStore,
  PublicationIdAuthority,
  PublicationUnsubscribeLinkIssuer,
} from './servicePorts'
export type {
  OciEmailDeliveryProvider,
  PublicationDomainStore,
  PublicationIdAuthority,
  PublicationUnsubscribeLinkIssuer,
} from './servicePorts'

export class PublicationDomainError extends Error {
  readonly code: 'conflict' | 'invalid-transition' | 'not-found' | 'settings-incomplete' | 'suppressed' | 'provider-rejected' | 'token-invalid'

  constructor(code: PublicationDomainError['code'], message: string) {
    super(message)
    this.name = 'PublicationDomainError'
    this.code = code
  }
}

const MAX_SUMMARY_RANGE_MS = 366 * 24 * 60 * 60 * 1000
const SETTINGS_ORDER: readonly EmailSettingsLayer['scope'][] = ['platform', 'organization', 'workspace', 'site', 'newsletter']
const REQUIRED_SETTING_KEYS = ['senderName', 'senderEmail', 'replyToEmail', 'physicalAddress', 'brandColor', 'footerText'] as const
const TRANSITIONS: Readonly<Record<PublicationContentStatus, readonly PublicationContentStatus[]>> = Object.freeze({
  draft: ['in-review', 'scheduled', 'published', 'archived'],
  'in-review': ['draft', 'approved', 'archived'],
  approved: ['draft', 'scheduled', 'published', 'archived'],
  scheduled: ['draft', 'approved', 'published', 'unpublished', 'archived'],
  published: ['unpublished', 'archived'],
  unpublished: ['draft', 'scheduled', 'published', 'archived'],
  archived: ['draft'],
})

export function canonicalPublicationJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalPublicationJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalPublicationJson(record[key])}`).join(',')}}`
}

function assertBoundedRange(from: string, to: string, label: string): void {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > MAX_SUMMARY_RANGE_MS) {
    throw new RangeError(`${label} range must be valid, increasing, and at most 366 days.`)
  }
}

export class PublicationEditorialService {
  readonly #store: PublicationDomainStore
  readonly #jobs: FumaJobService | null
  readonly #workflow: Pick<PublicationWorkflowService, 'scheduledReadiness'> | null

  constructor(store: PublicationDomainStore, jobs: FumaJobService | null = null, workflow: Pick<PublicationWorkflowService, 'scheduledReadiness'> | null = null) {
    this.#store = store
    this.#jobs = jobs
    this.#workflow = workflow
  }

  async save(scope: PublicationRepositoryScope, input: PublicationContent, expectedVersion: number | null): Promise<PublicationContent> {
    const candidate = parsePublicationContract('content', PublicationContentSchema, input)
    if (candidate.metadata.primaryTagId !== null && !candidate.metadata.tagIds.includes(candidate.metadata.primaryTagId)) {
      throw new TypeError('Primary Publication tag must be one of the content tags.')
    }
    let content: PublicationContent = candidate
    if (expectedVersion === null) {
      if (candidate.workflowVersion !== 1 || candidate.status !== 'draft' || candidate.scheduledAt !== null || candidate.publishedAt !== null) {
        throw new PublicationDomainError('invalid-transition', 'New Publication content must begin as draft version 1.')
      }
    } else {
      const current = await this.#store.getContent(scope, candidate.contentId)
      if (!current || current.workflowVersion !== expectedVersion) {
        throw new PublicationDomainError('conflict', 'Publication content changed concurrently.')
      }
      if (
        candidate.kind !== current.kind
        || candidate.status !== current.status
        || candidate.scheduledAt !== current.scheduledAt
        || candidate.publishedAt !== current.publishedAt
      ) {
        throw new PublicationDomainError('invalid-transition', 'Draft save cannot change workflow authority.')
      }
      content = parsePublicationContract('content', PublicationContentSchema, {
        ...candidate,
        workflowVersion: expectedVersion + 1,
        createdAt: current.createdAt,
      })
    }
    assertPublicationMetadataAuthority(replacePublicationAuthorityRecord(await this.#store.listContent(scope), content))
    if (!await this.#store.putContent(scope, content, expectedVersion)) {
      throw new PublicationDomainError('conflict', 'Publication content changed concurrently.')
    }
    return content
  }

  async importMany(scope: PublicationRepositoryScope, input: PublicationContentImport): Promise<readonly PublicationContent[]> {
    const command = parsePublicationContract('content import', PublicationContentImportSchema, input)
    const stableIds = command.items.map((item) => item.content.contentId)
    if (new Set(stableIds).size !== stableIds.length) throw new TypeError('Publication import contains duplicate stable IDs.')
    for (const item of command.items) {
      if (item.content.metadata.primaryTagId !== null && !item.content.metadata.tagIds.includes(item.content.metadata.primaryTagId)) {
        throw new TypeError('Imported primary tag must be included in tag relations.')
      }
      if (item.expectedVersion === null) {
        if (item.content.workflowVersion !== 1 || item.content.status !== 'draft' || item.content.scheduledAt !== null || item.content.publishedAt !== null) throw new PublicationDomainError('invalid-transition', 'New imported content must begin as draft version 1.')
      } else if (item.content.workflowVersion !== item.expectedVersion + 1) {
        throw new PublicationDomainError('conflict', 'Imported Publication authority revision is not monotonic.')
      }
    }
    let authority = await this.#store.listContent(scope)
    for (const item of command.items) authority = replacePublicationAuthorityRecord(authority, item.content)
    assertPublicationMetadataAuthority(authority)
    if (!await this.#store.importContent(scope, command)) {
      throw new PublicationDomainError('conflict', 'Publication import conflicts with current universal rows.')
    }
    return command.items.map((item) => item.content)
  }

  async remove(scope: PublicationRepositoryScope, contentId: string, expectedVersion: number): Promise<void> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new TypeError('Expected Publication version is invalid.')
    if (!await this.#store.deleteContent(scope, contentId, expectedVersion)) {
      throw new PublicationDomainError('conflict', 'Publication content changed concurrently or was not found.')
    }
  }

  async transition(scope: PublicationRepositoryScope, input: PublicationWorkflowTransition): Promise<PublicationContent> {
    const transition = parsePublicationContract('workflow transition', PublicationWorkflowTransitionSchema, input)
    const current = await this.#store.getContent(scope, transition.contentId)
    if (!current) throw new PublicationDomainError('not-found', 'Publication content was not found.')
    if (
      current.status !== transition.from
      || current.workflowVersion !== transition.expectedVersion
      || !TRANSITIONS[current.status].includes(transition.to)
    ) {
      throw new PublicationDomainError('invalid-transition', 'Editorial workflow transition is not valid for the current version.')
    }
    if (
      transition.to === 'scheduled'
      && (transition.scheduledAt === null || Date.parse(transition.scheduledAt) <= Date.parse(transition.createdAt))
    ) {
      throw new PublicationDomainError('invalid-transition', 'Scheduled content requires a future run time.')
    }
    if (transition.to !== 'scheduled' && transition.scheduledAt !== null) {
      throw new PublicationDomainError('invalid-transition', 'Only a scheduled transition may carry a schedule time.')
    }
    if (this.#workflow && (transition.to === 'scheduled' || (transition.to === 'published' && current.status !== 'scheduled'))) {
      const readiness = await this.#workflow.scheduledReadiness(scope, current.contentId, current.workflowVersion)
      if (!readiness.ready) {
        throw new PublicationDomainError('invalid-transition', 'Scheduling and direct publication require approval of the current revision.')
      }
    }

    const next = parsePublicationContract('content', PublicationContentSchema, {
      ...current,
      status: transition.to,
      workflowVersion: current.workflowVersion + 1,
      scheduledAt: transition.to === 'scheduled' ? transition.scheduledAt : null,
      publishedAt: transition.to === 'published' ? transition.createdAt : current.publishedAt,
      updatedAt: transition.createdAt,
    })
    assertPublicationMetadataAuthority(replacePublicationAuthorityRecord(await this.#store.listContent(scope), next))
    if (transition.to === 'scheduled' && this.#jobs) {
      await this.#jobs.enqueue({
        id: `publication-publish-${transition.transitionId}`,
        organizationId: scope.organizationId,
        siteId: scope.siteId,
        kind: 'publication.publish-due',
        payload: { contentId: next.contentId, workflowVersion: next.workflowVersion },
        runAt: transition.scheduledAt!,
        idempotencyKey: `publication:${scope.ownerKey}:${scope.generation}:${next.contentId}:${next.workflowVersion}`,
      })
    }
    if (!await this.#store.commitWorkflowTransition(scope, next, transition, current.workflowVersion)) {
      throw new PublicationDomainError('conflict', 'Editorial workflow lost its compare-and-swap.')
    }
    return next
  }

  async publishDue(scope: PublicationRepositoryScope, input: Readonly<{
    contentId: string
    workflowVersion: number
    actorId: string
    now: string
  }>): Promise<PublicationContent | null> {
    const current = await this.#store.getContent(scope, input.contentId)
    if (
      !current
      || current.status !== 'scheduled'
      || current.workflowVersion !== input.workflowVersion
      || current.scheduledAt === null
      || Date.parse(current.scheduledAt) > Date.parse(input.now)
    ) return null
    return await this.transition(scope, {
      transitionId: `due-${input.contentId}-${input.workflowVersion}`,
      contentId: input.contentId,
      from: 'scheduled',
      to: 'published',
      actorId: input.actorId,
      expectedVersion: input.workflowVersion,
      scheduledAt: null,
      note: 'Published by durable schedule.',
      createdAt: input.now,
    })
  }

  async saveTemplate(scope: PublicationRepositoryScope, input: PublicationTemplate, expectedVersion: number | null): Promise<PublicationTemplate> {
    const template = parsePublicationContract('template', PublicationTemplateSchema, input)
    if ((expectedVersion === null && template.version !== 1) || (expectedVersion !== null && template.version !== expectedVersion + 1)) {
      throw new PublicationDomainError('conflict', 'Publication template version is not monotonic.')
    }
    if (!await this.#store.putTemplate(scope, template, expectedVersion)) {
      throw new PublicationDomainError('conflict', 'Publication template changed concurrently.')
    }
    return template
  }
}

export class PublicationIdentityService {
  readonly #store: PublicationDomainStore
  constructor(store: PublicationDomainStore) { this.#store = store }

  get(scope: PublicationRepositoryScope): Promise<PublicationSettings | null> {
    return this.#store.getSettings(scope)
  }

  async save(scope: PublicationRepositoryScope, input: PublicationSettings, expectedVersion: number | null): Promise<PublicationSettings> {
    const settings = parsePublicationContract('Publication settings', PublicationSettingsSchema, input)
    if ((expectedVersion === null && settings.version !== 1) || (expectedVersion !== null && settings.version !== expectedVersion + 1)) {
      throw new PublicationDomainError('conflict', 'Publication settings version is not monotonic.')
    }
    if (!await this.#store.putSettings(scope, settings, expectedVersion)) {
      throw new PublicationDomainError('conflict', 'Publication settings changed concurrently.')
    }
    return settings
  }
}

export function memberMatchesSegment(member: PublicationMember, segment: PublicationSegment): boolean {
  const matches = segment.rules.map((rule: PublicationSegment['rules'][number]) => {
    if (rule.operator === 'in') return rule.values.includes(member.status)
    const value = rule.field === 'email' ? member.email : rule.field === 'name' ? member.name : member.attributes[rule.field]
    if (rule.operator === 'exists') return value !== null && value !== undefined
    return value === rule.value
  })
  return segment.match === 'all' ? matches.every(Boolean) : matches.some(Boolean)
}

export class PublicationAudienceService {
  readonly #store: PublicationDomainStore
  constructor(store: PublicationDomainStore) { this.#store = store }

  async saveReaderAccount(scope: PublicationRepositoryScope, input: PublicationReaderAccount): Promise<PublicationReaderAccount> {
    const account = parsePublicationContract('reader account', PublicationReaderAccountSchema, input)
    if (!await this.#store.putReaderAccount(scope, account)) throw new PublicationDomainError('conflict', 'Reader account already exists.')
    return account
  }

  async saveMember(scope: PublicationRepositoryScope, input: PublicationMember): Promise<PublicationMember> {
    const member = parsePublicationContract('member', PublicationMemberSchema, input)
    if (!await this.#store.putMember(scope, member)) throw new PublicationDomainError('conflict', 'Member email or identity conflicts.')
    return member
  }

  async saveSegment(scope: PublicationRepositoryScope, input: PublicationSegment, expectedVersion: number | null): Promise<PublicationSegment> {
    const segment = parsePublicationContract('segment', PublicationSegmentSchema, input)
    if ((expectedVersion === null && segment.version !== 1) || (expectedVersion !== null && segment.version !== expectedVersion + 1)) {
      throw new PublicationDomainError('conflict', 'Segment version is not monotonic.')
    }
    if (!await this.#store.putSegment(scope, segment, expectedVersion)) throw new PublicationDomainError('conflict', 'Segment changed concurrently.')
    return segment
  }

  async resolveSegment(scope: PublicationRepositoryScope, segmentId: string): Promise<readonly PublicationMember[]> {
    const segment = await this.#store.getSegment(scope, segmentId)
    if (!segment) throw new PublicationDomainError('not-found', 'Segment was not found.')
    return Object.freeze((await this.#store.listMembers(scope))
      .filter((member) => member.status !== 'blocked' && member.status !== 'unsubscribed' && memberMatchesSegment(member, segment))
      .toSorted((left, right) => left.memberId.localeCompare(right.memberId)))
  }

  async grant(scope: PublicationRepositoryScope, input: PublicationAccessGrant): Promise<PublicationAccessGrant> {
    const grant = parsePublicationContract('access grant', PublicationAccessGrantSchema, input)
    if (!await this.#store.putAccessGrant(scope, grant)) throw new PublicationDomainError('conflict', 'Access grant identity already exists.')
    return grant
  }

  async canRead(scope: PublicationRepositoryScope, memberId: string, resourceKind: PublicationAccessGrant['resourceKind'], resourceId: string, now: Date): Promise<boolean> {
    return (await this.#store.listAccessGrants(scope, memberId)).some((grant) => (
      grant.resourceKind === resourceKind
      && grant.resourceId === resourceId
      && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now.getTime())
    ))
  }
}

export class PublicationAnalyticsService {
  readonly #store: PublicationDomainStore
  constructor(store: PublicationDomainStore) { this.#store = store }

  async record(scope: PublicationRepositoryScope, input: PublicationAnalyticsEvent): Promise<boolean> {
    return await this.#store.appendAnalyticsEvent(scope, parsePublicationContract('analytics event', PublicationAnalyticsEventSchema, input))
  }

  summary(scope: PublicationRepositoryScope, from: string, to: string): Promise<PublicationAnalyticsSummary> {
    assertBoundedRange(from, to, 'Analytics')
    return this.#store.analyticsSummary(scope, from, to)
  }
}

export function resolveEmailSettings(layers: readonly EmailSettingsLayer[]): ResolvedEmailSettings {
  const identities = new Set<string>()
  for (const layer of layers) {
    const identity = `${layer.scope}\0${layer.scopeId}`
    if (identities.has(identity)) throw new PublicationDomainError('conflict', 'Email settings hierarchy contains a duplicate layer.')
    identities.add(identity)
  }
  const ordered = [...layers].sort((left, right) => (
    SETTINGS_ORDER.indexOf(left.scope) - SETTINGS_ORDER.indexOf(right.scope)
    || left.scopeId.localeCompare(right.scopeId)
  ))
  const values: Record<string, unknown> = {}
  const provenance: Record<string, { scope: string; scopeId: string; version: number }> = {}
  for (const layer of ordered) {
    for (const [key, value] of Object.entries(layer.values)) {
      if (value === undefined) continue
      values[key] = value
      provenance[key] = { scope: layer.scope, scopeId: layer.scopeId, version: layer.version }
    }
  }
  for (const key of REQUIRED_SETTING_KEYS) {
    if (values[key] === undefined) throw new PublicationDomainError('settings-incomplete', `Email setting ${key} is required.`)
  }
  return parsePublicationContract('resolved email settings', ResolvedEmailSettingsSchema, { values, provenance })
}

export class PublicationEmailSettingsService {
  readonly #store: PublicationDomainStore
  constructor(store: PublicationDomainStore) { this.#store = store }

  async save(scope: PublicationRepositoryScope, input: EmailSettingsLayer, expectedVersion: number | null): Promise<EmailSettingsLayer> {
    const layer = parsePublicationContract('email settings layer', EmailSettingsLayerSchema, input)
    if ((expectedVersion === null && layer.version !== 1) || (expectedVersion !== null && layer.version !== expectedVersion + 1)) {
      throw new PublicationDomainError('conflict', 'Email settings version is not monotonic.')
    }
    if (!await this.#store.putEmailSettingsLayer(scope, layer, expectedVersion)) throw new PublicationDomainError('conflict', 'Email settings changed concurrently.')
    return layer
  }

  async resolve(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<ResolvedEmailSettings> {
    return resolveEmailSettings(await this.#store.listEmailSettingsLayers(scope, newsletterId))
  }
}

export class PublicationNewsletterService {
  readonly #store: PublicationDomainStore
  readonly #settings: PublicationEmailSettingsService
  readonly #oci: OciEmailDeliveryProvider

  constructor(store: PublicationDomainStore, settings: PublicationEmailSettingsService, oci: OciEmailDeliveryProvider) {
    if (oci.kind !== 'oci-email-delivery') throw new TypeError('Launch email provider must be OCI Email Delivery.')
    this.#store = store
    this.#settings = settings
    this.#oci = oci
  }

  async save(scope: PublicationRepositoryScope, input: Newsletter): Promise<Newsletter> {
    const newsletter = parsePublicationContract('newsletter', NewsletterSchema, input)
    if (!await this.#store.putNewsletter(scope, newsletter)) throw new PublicationDomainError('conflict', 'Newsletter slug or identity conflicts.')
    return newsletter
  }

  async createVersion(scope: PublicationRepositoryScope, input: NewsletterVersion): Promise<NewsletterVersion> {
    const candidate = parsePublicationContract('newsletter version', NewsletterVersionSchema, input)
    const newsletter = await this.#store.getNewsletter(scope, candidate.newsletterId)
    if (!newsletter || newsletter.status === 'archived') throw new PublicationDomainError('not-found', 'Newsletter was not found or is archived.')
    const version = parsePublicationContract('newsletter version', NewsletterVersionSchema, {
      ...candidate,
      lockedAt: candidate.lockedAt ?? candidate.createdAt,
    })
    if (!await this.#store.appendNewsletterVersion(scope, version)) {
      throw new PublicationDomainError('conflict', 'Newsletter version ordinal or identity already exists.')
    }
    return version
  }

  async version(scope: PublicationRepositoryScope, versionId: string): Promise<NewsletterVersion> {
    const version = await this.#store.getNewsletterVersion(scope, versionId)
    if (!version || version.lockedAt === null) throw new PublicationDomainError('not-found', 'Locked newsletter version was not found.')
    return version
  }

  async preview(scope: PublicationRepositoryScope, versionId: string): Promise<NewsletterPreview> {
    const version = await this.version(scope, versionId)
    const settings = await this.#settings.resolve(scope, version.newsletterId)
    const rendered = await renderEmailDocument(version.document)
    return Object.freeze({ versionId, resolvedSubject: version.subject, html: rendered.html, text: rendered.text, settings })
  }

  async testSend(scope: PublicationRepositoryScope, input: NewsletterTestSendCommand): Promise<string> {
    const command = parsePublicationContract('newsletter test send', NewsletterTestSendCommandSchema, input)
    const preview = await this.preview(scope, command.versionId)
    const result = await this.#oci.submit({
      idempotencyKey: `test:${scope.ownerKey}:${scope.generation}:${command.idempotencyKey}`,
      recipient: command.recipient,
      senderEmail: preview.settings.values.senderEmail,
      senderName: preview.settings.values.senderName,
      replyToEmail: preview.settings.values.replyToEmail,
      subject: `[TEST] ${preview.resolvedSubject}`,
      html: preview.html,
      text: preview.text,
      headers: { 'X-Fuma-Test': 'true' },
    })
    return result.providerMessageId
  }
}

export class PublicationCampaignService {
  readonly #store: PublicationDomainStore
  readonly #audience: PublicationAudienceService
  readonly #newsletters: PublicationNewsletterService
  readonly #ids: PublicationIdAuthority
  readonly #jobs: FumaJobService | null
  readonly #oci: OciEmailDeliveryProvider
  readonly #unsubscribe: PublicationUnsubscribeLinkIssuer | null
  readonly #now: () => Date

  constructor(input: Readonly<{
    store: PublicationDomainStore
    audience: PublicationAudienceService
    newsletters: PublicationNewsletterService
    ids: PublicationIdAuthority
    jobs?: FumaJobService
    oci: OciEmailDeliveryProvider
    unsubscribe?: PublicationUnsubscribeLinkIssuer
    now?: () => Date
  }>) {
    if (input.oci.kind !== 'oci-email-delivery') throw new TypeError('Launch campaign provider must be OCI Email Delivery.')
    this.#store = input.store
    this.#audience = input.audience
    this.#newsletters = input.newsletters
    this.#ids = input.ids
    this.#jobs = input.jobs ?? null
    this.#oci = input.oci
    this.#unsubscribe = input.unsubscribe ?? null
    this.#now = input.now ?? (() => new Date())
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
    const createdAt = this.#now().toISOString()
    if (command.scheduledAt !== null && Date.parse(command.scheduledAt) <= Date.parse(createdAt)) {
      throw new PublicationDomainError('invalid-transition', 'Scheduled campaigns require a future run time.')
    }
    const audienceMemberIds = members.map(({ memberId }) => memberId).toSorted()
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
      scheduledAt: command.scheduledAt,
      createdAt,
    }
    const snapshot = parsePublicationContract('campaign snapshot', CampaignSnapshotSchema, {
      ...immutableSnapshot,
      status: command.scheduledAt ? 'scheduled' : 'draft',
      snapshotSha256: this.#ids.sha256(canonicalPublicationJson(immutableSnapshot)),
    })
    const deliveries: CampaignDelivery[] = members.map((member) => ({
      deliveryId: this.#ids.id('delivery'),
      campaignId: snapshot.campaignId,
      memberId: member.memberId,
      recipientEmail: member.email,
      status: 'queued',
      providerMessageId: null,
      attempt: 0,
      updatedAt: createdAt,
    }))
    if (await this.#store.getCampaign(scope,snapshot.campaignId)) throw new PublicationDomainError('conflict', 'Campaign identity already exists.')
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
    if (!await this.#store.putCampaignWithDeliveries(scope, snapshot, deliveries)) {
      throw new PublicationDomainError('conflict', 'Campaign identity already exists.')
    }
    return snapshot
  }

  async send(scope: PublicationRepositoryScope, campaignId: string, expectedSnapshotSha256?: string): Promise<readonly CampaignDelivery[]> {
    const campaign = await this.#store.getCampaign(scope, campaignId)
    if (!campaign) throw new PublicationDomainError('not-found', 'Campaign was not found.')
    if (expectedSnapshotSha256 !== undefined && campaign.snapshotSha256 !== expectedSnapshotSha256) {
      throw new PublicationDomainError('conflict', 'Campaign snapshot checksum changed.')
    }
    const deliveries = await this.#store.listDeliveries(scope, campaignId)
    const next: CampaignDelivery[] = []
    for (const delivery of deliveries) {
      if (['submitted', 'delivered', 'bounced', 'complained', 'suppressed'].includes(delivery.status)) {
        next.push(delivery)
        continue
      }
      const emailHash = this.#ids.sha256(delivery.recipientEmail.trim().toLowerCase())
      if (await this.#store.isSuppressed(scope, emailHash)) {
        next.push({ ...delivery, status: 'suppressed', updatedAt: this.#now().toISOString() })
        continue
      }
      try {
        const unsubscribeUrl = this.#unsubscribe
          ? await this.#unsubscribe.issue(scope, {
              memberId: delivery.memberId,
              newsletterId: campaign.newsletterId,
              recipientEmail: delivery.recipientEmail,
              issuedAt: this.#now().toISOString(),
            })
          : null
        const result = await this.#oci.submit({
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
        })
        next.push({
          ...delivery,
          status: 'submitted',
          providerMessageId: result.providerMessageId,
          attempt: delivery.attempt + 1,
          updatedAt: this.#now().toISOString(),
        })
      } catch (_error) {
        next.push({ ...delivery, status: 'failed', attempt: delivery.attempt + 1, updatedAt: this.#now().toISOString() })
      }
    }
    await this.#store.putDeliveries(scope, next)
    return Object.freeze(next)
  }
}

export class PublicationDeliverabilityService {
  readonly #store: PublicationDomainStore
  readonly #ids: PublicationIdAuthority
  readonly #now: () => Date

  constructor(store: PublicationDomainStore, ids: PublicationIdAuthority, now: () => Date = () => new Date()) {
    this.#store = store
    this.#ids = ids
    this.#now = now
  }

  async suppress(scope: PublicationRepositoryScope, input: Suppression): Promise<Suppression> {
    const suppression = parsePublicationContract('suppression', SuppressionSchema, input)
    await this.#store.putSuppression(scope, suppression)
    return suppression
  }

  async issueUnsubscribe(scope: PublicationRepositoryScope, input: UnsubscribeTokenClaims): Promise<UnsubscribeTokenClaims> {
    const claims = parsePublicationContract('unsubscribe claims', UnsubscribeTokenClaimsSchema, input)
    if (Date.parse(claims.expiresAt) <= Date.parse(claims.issuedAt)) {
      throw new PublicationDomainError('token-invalid', 'Unsubscribe token expiry must follow issuance.')
    }
    if (!await this.#store.getMember(scope, claims.memberId)) throw new PublicationDomainError('not-found', 'Unsubscribe member was not found.')
    if (!await this.#store.issueUnsubscribeToken(scope, claims)) throw new PublicationDomainError('conflict', 'Unsubscribe token identity already exists.')
    return claims
  }

  async unsubscribe(scope: PublicationRepositoryScope, tokenId: string): Promise<Suppression> {
    const now = this.#now().toISOString()
    const token = await this.#store.getUnsubscribeToken(scope, tokenId)
    if (!token || Date.parse(token.expiresAt) <= Date.parse(now)) {
      throw new PublicationDomainError('token-invalid', 'Unsubscribe token is invalid, expired, or already consumed.')
    }
    const member = await this.#store.getMember(scope, token.memberId)
    if (!member) throw new PublicationDomainError('token-invalid', 'Unsubscribe token is invalid, expired, or already consumed.')
    const suppression = parsePublicationContract('suppression', SuppressionSchema, {
      suppressionId: this.#ids.id('suppression'),
      emailHashSha256: this.#ids.sha256(member.email.trim().toLowerCase()),
      reason: 'unsubscribe',
      sourceId: tokenId,
      createdAt: now,
    })
    const claims = await this.#store.consumeUnsubscribeAndSuppress(scope, tokenId, now, suppression)
    if (!claims || claims.memberId !== member.memberId) {
      throw new PublicationDomainError('token-invalid', 'Unsubscribe token is invalid, expired, or already consumed.')
    }
    return suppression
  }

  async ingestOciEvent(scope: PublicationRepositoryScope, rawBody: string, input: OciEmailProviderEvent): Promise<boolean> {
    const event = parsePublicationContract('OCI provider event', OciEmailProviderEventSchema, input)
    const suppression = event.eventType === 'bounced' || event.eventType === 'complained'
      ? parsePublicationContract('suppression', SuppressionSchema, {
          suppressionId: this.#ids.id('suppression'),
          emailHashSha256: this.#ids.sha256(event.recipientEmail.trim().toLowerCase()),
          reason: event.eventType === 'bounced' ? 'hard-bounce' : 'complaint',
          sourceId: event.eventId,
          createdAt: event.occurredAt,
        })
      : null
    return await this.#store.recordProviderEvent(scope, event, this.#ids.sha256(rawBody), suppression)
  }

  summary(scope: PublicationRepositoryScope, from: string, to: string): Promise<DeliverabilitySummary> {
    assertBoundedRange(from, to, 'Deliverability')
    return this.#store.deliverabilitySummary(scope, from, to)
  }
}
