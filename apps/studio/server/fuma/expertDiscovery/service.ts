import type { FumaRequestContext } from '../context'
import type { FumaRepositoryScope } from '../tenancy/repositoryScope'
import {
  ApproveExpertReleaseCommandSchema,
  ExpertDiscoveryError,
  ExpertIdSchema,
  ExpertInquiryReceiptSchema,
  ExpertManagementProjectionSchema,
  ExpertPluginLinkSchema,
  ExpertProfileRecordSchema,
  ExpertSearchQuerySchema,
  ExpertSearchResultSchema,
  LinkExpertPluginCommandSchema,
  SetExpertVisibilityCommandSchema,
  SubmitExpertInquiryCommandSchema,
  TransferExpertCommandSchema,
  EXPERT_DISCOVERY_INTEGRATION,
  parseExpertContract,
  type ExpertInquiryReceipt,
  type ExpertManagementProjection,
  type ExpertPluginLink,
  type ExpertProfileRecord,
  type ExpertSearchResult,
  type ExpertSiteScope,
} from './contracts'

export type TrustedExpertRequest = Readonly<{
  context: FumaRequestContext
  scope: FumaRepositoryScope
  requestHeaders: Headers
}>

export interface ExpertDiscoveryRepository {
  approve(input: Readonly<{
    profile: ExpertProfileRecord
    artifactObjectKey: string
    artifactHashSha256: string
    submittedByActorId: string
    approvedByActorId: string
    expertConsent: Readonly<{ actorId: string; version: number; consentedAt: string }>
    siteOwnerConsent: Readonly<{ actorId: string; version: number; consentedAt: string }>
  }>): Promise<boolean>
  get(expertId: string): Promise<ExpertProfileRecord | null>
  listCandidates(): Promise<readonly ExpertProfileRecord[]>
  replace(profile: ExpertProfileRecord, expectedPublicRevision: number): Promise<boolean>
  putPluginLink(link: ExpertPluginLink, expectedPublicRevision: number): Promise<boolean>
  listPluginLinks(expertId: string): Promise<readonly ExpertPluginLink[]>
  putInquiry(receipt: ExpertInquiryReceipt, senderFingerprintSha256: string): Promise<boolean>
  inquiryCount(expertId: string): Promise<number>
}

export type ExpertCurrentAuthority = Readonly<{
  actorId: string
  sessionId: string
  direct: boolean
  stepUpAt: string | null
  managedOrganizationIds: readonly string[]
  capabilities: readonly string[]
}>
export interface ExpertDiscoveryAuthority {
  resolve(request: TrustedExpertRequest): Promise<ExpertCurrentAuthority>
  verifyAttribution(input: Readonly<{
    sourceScope: ExpertSiteScope
    submitterId: string
    expertConsentPartyId: string
    siteOwnerConsentPartyId: string
  }>): Promise<void>
}
export interface ExpertModerationAuthority { suspended(expertId: string): Promise<boolean> }
export interface ExpertPluginReviewAuthority { approved(pluginId: string): Promise<Readonly<{ publisherOrganizationId: string; verificationHashSha256: string }> | null> }
export interface ExpertTransferAuthority {
  resolveDestination(input: Readonly<{ transferId: string; expertId: string; source: ExpertSiteScope }>): Promise<ExpertSiteScope | null>
}
export interface ExpertInquiryAbuseAuthority { resolve(request: TrustedExpertRequest): Promise<Readonly<{ senderFingerprintSha256: string; blocked: boolean }>> }
export interface ExpertInquiryVault {
  store(input: Readonly<{ scope: ExpertSiteScope; inquiryId: string; expertId: string; sourceProfile: 'website' | 'publication'; message: string; createdAt: string; expiresAt: string }>): Promise<Readonly<{ objectKey: string; messageBytes: number }>>
  remove(input: Readonly<{ scope: ExpertSiteScope; objectKey: string }>): Promise<void>
}
export interface ExpertDiscoveryInvalidationPort {
  publish(input: Readonly<{ expertId: string; publicRevision: number; reason: 'approved' | 'visibility' | 'moderation' | 'plugin-link' | 'transfer' }>): Promise<void>
}

function deny(message: string, code: ExpertDiscoveryError['code'] = 'authority-denied'): never { throw new ExpertDiscoveryError(code, message) }
function requestScope(request: TrustedExpertRequest): ExpertSiteScope {
  const scope = request.scope
  if (scope.state !== 'active' || request.context.source.kind !== 'staff-session' || request.context.actor.kind !== 'staff') deny('A current active Better Auth staff session and exact site authority are required.')
  if (request.context.actor.userId !== request.context.source.userId || request.context.actor.sessionId !== request.context.source.sessionId) deny('Canonical actor/session correlation failed.')
  return Object.freeze({ platformId: scope.platformId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId, ownerKey: scope.ownerKey, ownerGeneration: scope.generation })
}
function validNow(now: () => Date): string {
  const value = now()
  if (!Number.isFinite(value.getTime())) throw new TypeError('Expert clock is invalid.')
  return value.toISOString()
}
function freshStepUp(authority: ExpertCurrentAuthority, now: string): void {
  const at = authority.stepUpAt === null ? Number.NaN : Date.parse(authority.stepUpAt)
  if (!authority.direct || !Number.isFinite(at) || Date.parse(now) - at < 0 || Date.parse(now) - at > 5 * 60_000) deny('A fresh direct session step-up is required.')
}
function canManage(authority: ExpertCurrentAuthority, organizationId: string): void {
  if (!authority.direct || !authority.managedOrganizationIds.includes(organizationId) || !authority.capabilities.includes('experts.manage')) deny('Current organization expert management authority is required.')
}
function currentAuthority(request: TrustedExpertRequest, authority: ExpertCurrentAuthority): ExpertCurrentAuthority {
  const source = request.context.source
  if (source.kind !== 'staff-session' || authority.actorId !== source.userId || authority.sessionId !== source.sessionId || authority.direct !== (source.impersonatedBy === null)) deny('Expert authority does not match the current canonical session.')
  return authority
}
function publicProfile(profile: ExpertProfileRecord) { return Object.freeze({ ...profile.public, mediatedInquiryAvailable: profile.public.mediatedInquiryAvailable && profile.availability !== 'unavailable' }) }
async function digest(items: readonly unknown[]): Promise<string> {
  const canonical = JSON.stringify(items, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  return `experts:sha256:${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export class ExpertDiscoveryService {
  readonly #repository: ExpertDiscoveryRepository
  readonly #authority: ExpertDiscoveryAuthority
  readonly #moderation: ExpertModerationAuthority
  readonly #plugins: ExpertPluginReviewAuthority
  readonly #transfers: ExpertTransferAuthority
  readonly #inquiryAbuse: ExpertInquiryAbuseAuthority
  readonly #vault: ExpertInquiryVault
  readonly #invalidation: ExpertDiscoveryInvalidationPort
  readonly #now: () => Date

  constructor(input: Readonly<{ repository: ExpertDiscoveryRepository; authority: ExpertDiscoveryAuthority; moderation: ExpertModerationAuthority; plugins: ExpertPluginReviewAuthority; transfers: ExpertTransferAuthority; inquiryAbuse: ExpertInquiryAbuseAuthority; vault: ExpertInquiryVault; invalidation: ExpertDiscoveryInvalidationPort; now?: () => Date }>) {
    this.#repository = input.repository; this.#authority = input.authority; this.#moderation = input.moderation; this.#plugins = input.plugins; this.#transfers = input.transfers; this.#inquiryAbuse = input.inquiryAbuse; this.#vault = input.vault; this.#invalidation = input.invalidation; this.#now = input.now ?? (() => new Date())
  }

  async approveRelease(request: TrustedExpertRequest, raw: unknown): Promise<ExpertProfileRecord> {
    const command = parseExpertContract(ApproveExpertReleaseCommandSchema, raw, 'expert release approval')
    const exactScope = requestScope(request)
    if (!command.supportedProfiles.includes(request.context.profile.id as 'website' | 'publication')) deny('Release does not support the current composed site profile.')
    const current = currentAuthority(request, await this.#authority.resolve(request)); freshStepUp(current, validNow(this.#now))
    if (!current.capabilities.includes('internal.experts.approve') || current.actorId === command.submitterId) deny('Independent internal expert release approval is required.')
    await this.#authority.verifyAttribution({ sourceScope: exactScope, submitterId: command.submitterId, expertConsentPartyId: command.expertConsent.partyId, siteOwnerConsentPartyId: command.siteOwnerConsent.partyId })
    const approvedAt = validNow(this.#now)
    const profile = parseExpertContract(ExpertProfileRecordSchema, {
      expertId: command.expertId, organizationId: exactScope.organizationId, sourceScope: exactScope,
      supportedProfiles: command.supportedProfiles, public: { ...command.public, approvedAt }, availability: command.availability,
      approvedReleaseId: command.releaseId, optedIn: false, consentVersion: command.expertConsent.version,
      publicRevision: 1, createdAt: approvedAt, updatedAt: approvedAt,
    }, 'approved expert profile')
    if (!await this.#repository.approve({ profile, artifactObjectKey: command.artifactObjectKey, artifactHashSha256: command.artifactHashSha256, submittedByActorId: command.submitterId, approvedByActorId: current.actorId, expertConsent: { actorId: command.expertConsent.partyId, version: command.expertConsent.version, consentedAt: command.expertConsent.consentedAt }, siteOwnerConsent: { actorId: command.siteOwnerConsent.partyId, version: command.siteOwnerConsent.version, consentedAt: command.siteOwnerConsent.consentedAt } })) deny('Expert release identity already exists.', 'conflict')
    await this.#invalidation.publish({ expertId: profile.expertId, publicRevision: profile.publicRevision, reason: 'approved' })
    return profile
  }

  async setVisibility(request: TrustedExpertRequest, raw: unknown): Promise<ExpertProfileRecord> {
    const command = parseExpertContract(SetExpertVisibilityCommandSchema, raw, 'expert visibility command'); requestScope(request)
    const current = currentAuthority(request, await this.#authority.resolve(request)); const profile = await this.required(command.expertId); canManage(current, profile.organizationId)
    const now = validNow(this.#now); const next = parseExpertContract(ExpertProfileRecordSchema, { ...profile, optedIn: command.optedIn, availability: command.availability, publicRevision: profile.publicRevision + 1, updatedAt: now }, 'updated expert profile')
    if (!await this.#repository.replace(next, command.expectedPublicRevision)) deny('Expert visibility revision conflicted.', 'conflict')
    await this.#invalidation.publish({ expertId: next.expertId, publicRevision: next.publicRevision, reason: 'visibility' }); return next
  }

  async search(raw: unknown): Promise<ExpertSearchResult> {
    const query = parseExpertContract(ExpertSearchQuerySchema, raw, 'expert search query')
    const visible: ExpertProfileRecord[] = []
    for (const profile of await this.#repository.listCandidates()) {
      if (!profile.optedIn || profile.availability === 'unavailable' || await this.#moderation.suspended(profile.expertId)) continue
      if (query.profile && !profile.supportedProfiles.includes(query.profile)) continue
      if (query.expertType && profile.public.expertType !== query.expertType) continue
      if (query.skill && !profile.public.skills.includes(query.skill)) continue
      if (query.location && profile.public.location.toLocaleLowerCase('en-KE') !== query.location.toLocaleLowerCase('en-KE')) continue
      visible.push(profile)
    }
    visible.sort((left, right) => Number(right.availability === 'available') - Number(left.availability === 'available') || right.publicRevision - left.publicRevision || left.expertId.localeCompare(right.expertId))
    const items = visible.slice(0, query.limit).map(publicProfile)
    return parseExpertContract(ExpertSearchResultSchema, { items, datasetVersion: await digest(items) }, 'expert search result')
  }

  async submitInquiry(request: TrustedExpertRequest, raw: unknown): Promise<ExpertInquiryReceipt> {
    const command = parseExpertContract(SubmitExpertInquiryCommandSchema, raw, 'expert inquiry'); const source = requestScope(request)
    const current = currentAuthority(request, await this.#authority.resolve(request)); if (!current.direct) deny('Impersonated sessions cannot submit expert inquiries.', 'inquiry-denied')
    const profile = await this.required(command.expertId)
    if (!profile.optedIn || profile.availability === 'unavailable' || !profile.public.mediatedInquiryAvailable || await this.#moderation.suspended(profile.expertId)) deny('Expert inquiry is unavailable.', 'inquiry-denied')
    const sourceProfile = request.context.profile.id
    if ((sourceProfile !== 'website' && sourceProfile !== 'publication') || !profile.supportedProfiles.includes(sourceProfile)) deny('Expert does not accept inquiries for this composed profile.', 'inquiry-denied')
    const abuse = await this.#inquiryAbuse.resolve(request); if (abuse.blocked || !/^[a-f0-9]{64}$/.test(abuse.senderFingerprintSha256)) deny('Expert inquiry abuse authority denied the sender.', 'inquiry-denied')
    const createdAt = validNow(this.#now); const expiresAt = new Date(Date.parse(createdAt) + 7 * 86_400_000).toISOString()
    let stored: Awaited<ReturnType<ExpertInquiryVault['store']>>
    try { stored = await this.#vault.store({ scope: source, inquiryId: command.inquiryId, expertId: profile.expertId, sourceProfile, message: command.message, createdAt, expiresAt }) } catch { deny('Encrypted inquiry custody failed.', 'storage-denied') }
    const value = parseExpertContract(ExpertInquiryReceiptSchema, { inquiryId: command.inquiryId, expertId: profile.expertId, sourceProfile, state: 'queued', messageBytes: stored.messageBytes, encryptedObjectKey: stored.objectKey, consentVersion: profile.consentVersion, createdAt, expiresAt }, 'expert inquiry receipt')
    let persisted: boolean
    try {
      persisted = await this.#repository.putInquiry(value, abuse.senderFingerprintSha256)
    } catch {
      try { await this.#vault.remove({ scope: source, objectKey: stored.objectKey }) } catch { deny('Inquiry receipt persistence and encrypted custody cleanup failed.', 'storage-denied') }
      deny('Inquiry receipt persistence failed.', 'storage-denied')
    }
    if (!persisted) {
      try { await this.#vault.remove({ scope: source, objectKey: stored.objectKey }) } catch { deny('Conflicting inquiry ciphertext could not be removed.', 'storage-denied') }
      deny('Inquiry identity already exists.', 'conflict')
    }
    return value
  }

  async linkPlugin(request: TrustedExpertRequest, raw: unknown): Promise<ExpertPluginLink> {
    const command = parseExpertContract(LinkExpertPluginCommandSchema, raw, 'expert plugin link'); requestScope(request)
    const current = currentAuthority(request, await this.#authority.resolve(request)); const profile = await this.required(command.expertId); canManage(current, profile.organizationId)
    const approved = await this.#plugins.approved(command.pluginId); if (!approved) deny('Only a currently reviewed plugin can be linked.', 'hidden')
    const link = parseExpertContract(ExpertPluginLinkSchema, {
      expertId: profile.expertId,
      pluginId: command.pluginId,
      publisherOrganizationId: approved.publisherOrganizationId,
      verificationHashSha256: approved.verificationHashSha256,
      verifiedAt: validNow(this.#now),
      revokedAt: null,
    }, 'reviewed expert plugin link')
    if (!await this.#repository.putPluginLink(link, command.expectedPublicRevision)) deny('Expert plugin-link revision conflicted.', 'conflict')
    await this.#invalidation.publish({ expertId: profile.expertId, publicRevision: profile.publicRevision + 1, reason: 'plugin-link' }); return link
  }

  async transfer(request: TrustedExpertRequest, raw: unknown): Promise<ExpertProfileRecord> {
    const command = parseExpertContract(TransferExpertCommandSchema, raw, 'expert transfer'); requestScope(request)
    const current = currentAuthority(request, await this.#authority.resolve(request)); const profile = await this.required(command.expertId); canManage(current, profile.organizationId); freshStepUp(current, validNow(this.#now))
    const destinationScope = await this.#transfers.resolveDestination({ transferId: command.transferId, expertId: profile.expertId, source: profile.sourceScope })
    if (!destinationScope) deny('Current completed transfer authority rejected the expert move.')
    const next = parseExpertContract(ExpertProfileRecordSchema, { ...profile, organizationId: destinationScope.organizationId, sourceScope: destinationScope, optedIn: false, publicRevision: profile.publicRevision + 1, updatedAt: validNow(this.#now) }, 'transferred expert profile')
    if (!await this.#repository.replace(next, command.expectedPublicRevision)) deny('Expert transfer revision conflicted.', 'conflict')
    await this.#invalidation.publish({ expertId: next.expertId, publicRevision: next.publicRevision, reason: 'transfer' }); return next
  }

  async moderationChanged(expertId: string): Promise<void> {
    const profile = await this.required(expertId)
    await this.#invalidation.publish({ expertId, publicRevision: profile.publicRevision, reason: 'moderation' })
  }

  async management(request: TrustedExpertRequest, expertId: string): Promise<ExpertManagementProjection> {
    requestScope(request); const parsedExpertId = parseExpertContract(ExpertIdSchema, expertId, 'expert management identifier'); const current = currentAuthority(request, await this.#authority.resolve(request)); const profile = await this.required(parsedExpertId); canManage(current, profile.organizationId)
    return parseExpertContract(ExpertManagementProjectionSchema, { profile, pluginLinks: await this.#repository.listPluginLinks(parsedExpertId), inquiryCount: await this.#repository.inquiryCount(parsedExpertId), integration: EXPERT_DISCOVERY_INTEGRATION }, 'expert management projection')
  }

  async required(expertId: string): Promise<ExpertProfileRecord> { const value = await this.#repository.get(expertId); if (!value) deny('Expert profile was not found.', 'not-found'); return value }
}
