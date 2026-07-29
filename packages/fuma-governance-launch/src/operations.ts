import { Buffer } from 'node:buffer'
import {
  BreakGlassRequestSchema,
  ConsoleActionEnvelopeSchema,
  ConsoleActionResultSchema,
  ConsoleContributionSchema,
  ConsoleQuerySchema,
  ExpertInquirySchema,
  ExpertProfileSchema,
  ExpertReleaseApprovalSchema,
  SupportSessionSchema,
  TransferHandoffSchema,
  parseStrict,
  type BreakGlassRequest,
  type ConsoleContribution,
  type ConsoleQuery,
  type ExpertInquiry,
  type ExpertProfile,
  type ExpertReleaseApproval,
  type SupportSession,
  type TransferHandoff,
} from './contracts'

export class OperationsPolicyError extends Error {
  readonly code: 'host-denied' | 'authority-denied' | 'contribution-denied' | 'support-denied' | 'break-glass-denied' | 'expert-hidden' | 'transfer-denied'
  constructor(code: 'host-denied' | 'authority-denied' | 'contribution-denied' | 'support-denied' | 'break-glass-denied' | 'expert-hidden' | 'transfer-denied', message: string) {
    super(message)
    this.code = code
    this.name = 'OperationsPolicyError'
  }
}

export type InternalAuthority = Readonly<{ actorId: string; host: string; authorities: ReadonlySet<string>; stepUpAt: string | null; protectedOwner: boolean }>

export function authorizeConsoleQuery(value: unknown, authority: InternalAuthority): ConsoleQuery {
  const query = parseStrict(ConsoleQuerySchema, value, 'console.query')
  if (authority.host !== 'admin.fuma.co.ke' || !authority.authorities.has('internal.console.read')) throw new OperationsPolicyError('authority-denied', 'Platform console read authority denied.')
  return query
}

const CONSOLE_FORBIDDEN_FIELD = /(?:password|secret|token|cookie|raw|ciphertext|privateKey|webhook|prompt|toolArgs)/i
export function redactConsoleRow(row: Readonly<Record<string, unknown>>, allowedFields: ReadonlySet<string>): Readonly<Record<string, string | number | boolean | null>> {
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(row)) if (allowedFields.has(key) && !CONSOLE_FORBIDDEN_FIELD.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) output[key] = value as string | number | boolean | null
  return Object.freeze(output)
}

export class PlatformConsoleRegistry {
  readonly #contributions = new Map<string, ConsoleContribution>()
  readonly #actionDelegates = new Map<string, ConsoleActionDelegate>()

  register(value: unknown): ConsoleContribution {
    const parsed = parseStrict(ConsoleContributionSchema, value, 'console.contribution')
    const { mounted: _unmounted, ...registered } = parsed
    const contribution = Object.freeze(registered) as ConsoleContribution
    if (this.#contributions.has(contribution.contributionId)) throw new OperationsPolicyError('contribution-denied', 'Console contribution identity already exists.')
    for (const current of this.#contributions.values()) {
      if (current.routes.some((route) => contribution.routes.includes(route))) throw new OperationsPolicyError('contribution-denied', 'Console route ownership overlaps.')
    }
    this.#contributions.set(contribution.contributionId, contribution)
    return structuredClone(contribution)
  }

  registerAction(delegate: ConsoleActionDelegate): void {
    if (!/^[a-z][a-z0-9.-]{2,119}$/.test(delegate.actionId)
      || !/^internal\.[a-z0-9.:-]+$/.test(delegate.requiredAuthority)
      || this.#actionDelegates.has(delegate.actionId)) {
      throw new OperationsPolicyError('contribution-denied', 'Console action delegate identity is invalid or already registered.')
    }
    this.#actionDelegates.set(delegate.actionId, delegate)
  }

  authorize(path: string, authority: InternalAuthority): ConsoleContribution {
    if (authority.host !== 'admin.fuma.co.ke') throw new OperationsPolicyError('host-denied', 'Platform console is admin-host only.')
    const contribution = [...this.#contributions.values()].find(({ routes }) => routes.includes(path))
    if (!contribution || contribution.requiredAuthorities.some((required) => !authority.authorities.has(required))) throw new OperationsPolicyError('authority-denied', 'Internal console authority denied.')
    return structuredClone(contribution)
  }

  action(actionId: string, authority: InternalAuthority, now: Date): ConsoleActionDelegate {
    if (authority.host !== 'admin.fuma.co.ke') throw new OperationsPolicyError('host-denied', 'Platform console is admin-host only.')
    const delegate = this.#actionDelegates.get(actionId)
    const steppedUpAt = authority.stepUpAt === null ? Number.NaN : Date.parse(authority.stepUpAt)
    const freshStepUp = Number.isFinite(steppedUpAt) && now.getTime() >= steppedUpAt && now.getTime() - steppedUpAt <= 5 * 60_000
    if (!delegate || !authority.authorities.has('internal.console.write') || !authority.authorities.has(delegate.requiredAuthority)
      || (delegate.requiresFreshStepUp && !freshStepUp)) {
      throw new OperationsPolicyError('authority-denied', 'Bounded console action authority denied.')
    }
    return delegate
  }

  list(): readonly ConsoleContribution[] { return Object.freeze([...this.#contributions.values()].map((value) => structuredClone(value))) }
  actions(): readonly string[] { return Object.freeze([...this.#actionDelegates.keys()].sort()) }
}

export type ConsoleScalar = string | number | boolean | null
export type ConsoleRow = Readonly<Record<string, ConsoleScalar>>
export type ConsolePage = Readonly<{
  view: ConsoleQuery['view']
  rows: readonly ConsoleRow[]
  nextCursor: string | null
  total: number
}>

export interface PlatformConsoleReadSource {
  read(view: ConsoleQuery['view']): Promise<readonly Readonly<Record<string, unknown>>[]>
}

export interface ConsoleActionDelegate {
  readonly actionId: string
  readonly requiredAuthority: string
  readonly requiresFreshStepUp: boolean
  execute(input: unknown, context: Readonly<{ actorId: string; requestId: string; now: string }>): Promise<unknown>
}

const CONSOLE_ALLOWED_FIELDS = Object.freeze({
  users: Object.freeze(['userId', 'displayName', 'emailHashSha256', 'status', 'createdAt']),
  organizations: Object.freeze(['organizationId', 'slug', 'name', 'kind', 'status', 'createdAt']),
  clients: Object.freeze(['organizationId', 'name', 'lifecycle', 'intendedWorkspaceId', 'intendedSiteId', 'createdAt']),
  workspaces: Object.freeze(['workspaceId', 'organizationId', 'slug', 'name', 'status', 'createdAt']),
  sites: Object.freeze(['siteId', 'workspaceId', 'organizationId', 'slug', 'name', 'profileId', 'status', 'createdAt']),
  plans: Object.freeze(['planId', 'version', 'cadence', 'amountMinor', 'currency', 'state', 'effectiveAt']),
  offers: Object.freeze(['offerId', 'version', 'organizationId', 'workspaceId', 'siteId', 'cadence', 'recurringAmountMinor', 'setupFeeMinor', 'currency', 'quotaState', 'costModelVersion', 'recurringExpectedCostMinor', 'setupExpectedCostMinor', 'marginBasisPoints', 'state', 'issuedAt', 'acceptedAt', 'expiresAt']),
  contracts: Object.freeze(['contractId', 'offerId', 'offerVersion', 'organizationId', 'workspaceId', 'siteId', 'state', 'setupPaymentState', 'recurringPaymentState', 'activatedAt', 'handoffState']),
  invoices: Object.freeze(['invoiceId', 'contractId', 'kind', 'amountMinor', 'currency', 'state', 'issuedAt', 'paidAt']),
  economics: Object.freeze(['organizationId', 'sourceId', 'revenueMinor', 'costMinor', 'marginBasisPoints', 'variableCogsBasisPoints', 'costModelVersion', 'periodStart', 'periodEnd']),
  usage: Object.freeze(['organizationId', 'sourceId', 'quotaClass', 'used', 'reserved', 'limit', 'remaining', 'percent', 'observedAt']),
  domains: Object.freeze(['domainId', 'organizationId', 'siteId', 'hostname', 'kind', 'desired', 'observed', 'certificate', 'updatedAt']),
  email: Object.freeze(['organizationId', 'siteId', 'domain', 'state', 'provider', 'lastCheckedAt']),
  jobs: Object.freeze(['jobId', 'kind', 'organizationId', 'siteId', 'state', 'attempt', 'nextAttemptAt', 'updatedAt']),
  releases: Object.freeze(['releaseId', 'organizationId', 'siteId', 'state', 'contentHashSha256', 'createdAt', 'activatedAt']),
  ai: Object.freeze(['providerId', 'modelId', 'displayName', 'enabled', 'visibility', 'costModelVersion', 'refreshedAt']),
  audit: Object.freeze(['eventId', 'actorId', 'action', 'targetKind', 'targetId', 'requestId', 'occurredAt']),
} satisfies Readonly<Record<ConsoleQuery['view'], readonly string[]>>)

function cursorFor(query: ConsoleQuery, offset: number): string {
  return Buffer.from(JSON.stringify({ view: query.view, filter: query.filter ?? null, offset }), 'utf8').toString('base64url')
}

function cursorOffset(query: ConsoleQuery): number {
  if (!query.cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.view !== query.view || parsed.filter !== (query.filter ?? null) || !Number.isSafeInteger(parsed.offset)
      || Number(parsed.offset) < 1 || Number(parsed.offset) > 1_000_000) throw new Error('cursor mismatch')
    return Number(parsed.offset)
  } catch {
    throw new OperationsPolicyError('authority-denied', 'Console pagination cursor is invalid for this query.')
  }
}

function searchable(row: ConsoleRow, filter: string): boolean {
  const needle = filter.toLocaleLowerCase('en-KE')
  return Object.values(row).some((value) => String(value ?? '').toLocaleLowerCase('en-KE').includes(needle))
}

export class PlatformConsoleService {
  readonly #source: PlatformConsoleReadSource
  readonly #registry: PlatformConsoleRegistry
  readonly #now: () => Date

  constructor(input: Readonly<{ source: PlatformConsoleReadSource; registry: PlatformConsoleRegistry; now?: () => Date }>) {
    this.#source = input.source
    this.#registry = input.registry
    this.#now = input.now ?? (() => new Date())
  }

  async query(value: unknown, authority: InternalAuthority): Promise<ConsolePage> {
    const query = authorizeConsoleQuery(value, authority)
    const allowed = new Set(CONSOLE_ALLOWED_FIELDS[query.view])
    const redacted = (await this.#source.read(query.view)).map((row) => redactConsoleRow(row, allowed))
    const filtered = query.filter ? redacted.filter((row) => searchable(row, query.filter!)) : redacted
    const offset = cursorOffset(query)
    if (offset > filtered.length) throw new OperationsPolicyError('authority-denied', 'Console pagination cursor is beyond the current result set.')
    const rows = Object.freeze(filtered.slice(offset, offset + query.limit))
    const nextOffset = offset + rows.length
    return Object.freeze({
      view: query.view,
      rows,
      nextCursor: nextOffset < filtered.length ? cursorFor(query, nextOffset) : null,
      total: filtered.length,
    })
  }

  async execute(value: unknown, authority: InternalAuthority): Promise<import('./contracts').ConsoleActionResult> {
    const envelope = parseStrict(ConsoleActionEnvelopeSchema, value, 'console.action')
    const now = this.#now()
    const delegate = this.#registry.action(envelope.actionId, authority, now)
    const result = await delegate.execute(envelope.input, { actorId: authority.actorId, requestId: envelope.requestId, now: now.toISOString() })
    const output = parseStrict(ConsoleActionResultSchema, result, 'console.action.result')
    if (output.actionId !== envelope.actionId || output.requestId !== envelope.requestId) {
      throw new OperationsPolicyError('contribution-denied', 'Console action delegate returned mismatched immutable identity.')
    }
    return Object.freeze(output)
  }
}

export function beginSupportSession(value: unknown, authority: InternalAuthority, now: Date): SupportSession {
  const session = parseStrict(SupportSessionSchema, value, 'support.session')
  const authorityStepUp = authority.stepUpAt === null ? Number.NaN : Date.parse(authority.stepUpAt)
  const startedAt = Date.parse(session.startedAt)
  const expiresAt = Date.parse(session.expiresAt)
  const steppedUp = Number.isFinite(authorityStepUp) && authority.stepUpAt === session.stepUpAt && now.getTime() - authorityStepUp >= 0 && now.getTime() - authorityStepUp <= 5 * 60_000
  if (authority.host !== 'admin.fuma.co.ke' || !authority.authorities.has('internal.support.impersonate') || authority.protectedOwner || !steppedUp || session.staffActorId !== authority.actorId || session.targetProtected || session.nested || startedAt > now.getTime() || now.getTime() - startedAt > 60_000 || expiresAt <= now.getTime() || expiresAt - startedAt > 30 * 60_000) throw new OperationsPolicyError('support-denied', 'Bounded support session policy denied.')
  return session
}

export function approveBreakGlass(value: unknown, input: { authority: InternalAuthority; now: Date; isolatedChannel: boolean; approvedActorIds: ReadonlySet<string> }): BreakGlassRequest {
  const request = parseStrict(BreakGlassRequestSchema, value, 'break-glass.request')
  const [first, second] = request.approverIds
  const steppedUp = input.authority.stepUpAt !== null && input.now.getTime() - Date.parse(input.authority.stepUpAt) >= 0 && input.now.getTime() - Date.parse(input.authority.stepUpAt) <= 5 * 60_000
  if (!input.isolatedChannel || !steppedUp || input.authority.host !== 'admin.fuma.co.ke' || !input.authority.authorities.has('internal.break-glass.approve') || !first || !second || first === second || !request.approverIds.includes(input.authority.actorId) || !input.approvedActorIds.has(first) || !input.approvedActorIds.has(second) || Date.parse(request.expiresAt) <= input.now.getTime() || Date.parse(request.expiresAt) - input.now.getTime() > 15 * 60_000) throw new OperationsPolicyError('break-glass-denied', 'Break-glass requires an isolated, live, dual-approver workflow.')
  return request
}

export type ModerationEvidence = Readonly<{ subjectId: string; state: 'open' | 'suspended' | 'appealed' | 'resolved'; reasonCode: string; objectHashSha256: string; createdAt: string }>

export function approveExpertRelease(value: unknown): ExpertReleaseApproval {
  const approval = parseStrict(ExpertReleaseApprovalSchema, value, 'expert.release-approval')
  if (approval.submittedByActorId === approval.approvedByActorId) throw new OperationsPolicyError('expert-hidden', 'Expert public releases require an independent approver and both attribution consents.')
  return approval
}

export function publicExpert(value: unknown): ExpertProfile {
  const expert = parseStrict(ExpertProfileSchema, value, 'expert.profile')
  if (!expert.optedIn || expert.suspended || expert.availability === 'unavailable') throw new OperationsPolicyError('expert-hidden', 'Expert profile is not publicly discoverable.')
  return expert
}

export function rankExperts(values: readonly unknown[], filter: { county?: string; skill?: string; limit: number }): readonly ExpertProfile[] {
  if (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 50) throw new OperationsPolicyError('expert-hidden', 'Expert search limit is invalid.')
  return values.map(publicExpert)
    .filter((expert) => (!filter.county || expert.county === filter.county) && (!filter.skill || expert.skills.includes(filter.skill)))
    .sort((left, right) => Number(right.availability === 'available') - Number(left.availability === 'available') || right.publicRevision - left.publicRevision || left.expertId.localeCompare(right.expertId))
    .slice(0, filter.limit)
}

export function authorizeExpertInquiry(value: unknown, expertValue: unknown, input: { now: Date; blockedSender: boolean }): ExpertInquiry {
  const expert = publicExpert(expertValue)
  const inquiry = parseStrict(ExpertInquirySchema, value, 'expert.inquiry')
  if (inquiry.expertId !== expert.expertId || inquiry.consentVersion !== expert.consentVersion || input.blockedSender || inquiry.state !== 'queued' || Date.parse(inquiry.createdAt) > input.now.getTime() || Date.parse(inquiry.expiresAt) <= input.now.getTime() || Date.parse(inquiry.expiresAt) - Date.parse(inquiry.createdAt) > 7 * 24 * 60 * 60_000) throw new OperationsPolicyError('expert-hidden', 'Expert inquiry is not eligible for mediated delivery.')
  return inquiry
}

export type TransferAuthoritySnapshot = Readonly<{
  contractId: string
  offerVersion: number
  paymentState: 'paid-transfer-pending' | 'partial' | 'unpaid'
  destinationOrganizationId: string
  destinationActive: boolean
  quotaAccepted: boolean
  legalAccepted: boolean
  commandIdempotencyKey: string
}>

export function authorizeTransferHandoff(value: unknown, authority: TransferAuthoritySnapshot): TransferHandoff {
  const handoff = parseStrict(TransferHandoffSchema, value, 'transfer.handoff')
  const everyAssetOwned = handoff.selectedAssets.every((asset) => Object.hasOwn(TRANSFER_STEP_OWNERS, asset))
  if (authority.paymentState !== 'paid-transfer-pending' || handoff.paymentState !== authority.paymentState || handoff.commandIdempotencyKey !== authority.commandIdempotencyKey || handoff.contractId !== authority.contractId || handoff.offerVersion !== authority.offerVersion || handoff.destinationOrganizationId !== authority.destinationOrganizationId || !authority.destinationActive || !authority.quotaAccepted || !authority.legalAccepted || !everyAssetOwned) throw new OperationsPolicyError('transfer-denied', 'Current paid contract, idempotency identity, destination, quota, legal authority, and registered asset owners are required.')
  return handoff
}

export const kenyaFormat = Object.freeze({
  money(minor: number): string {
    if (!Number.isSafeInteger(minor)) throw new OperationsPolicyError('transfer-denied', 'KES minor amount must be an exact integer.')
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)
  },
  dateTime(value: string): string {
    const time = Date.parse(value)
    if (!Number.isFinite(time)) throw new OperationsPolicyError('transfer-denied', 'Timestamp is invalid.')
    return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(time))
  },
})

export const TRANSFER_STEP_OWNERS = Object.freeze({ domain: 'FUMA-062', ai: 'FUMA-064', mcp: 'FUMA-066', plugins: 'FUMA-067', payments: 'FUMA-069', collaborators: 'FUMA-023' } as const)

export function authorizeSupportAction(sessionValue: unknown, input: { now: Date; actorId: string; capability: string; targetCapabilities: ReadonlySet<string>; targetProtected: boolean }): SupportSession {
  const session = parseStrict(SupportSessionSchema, sessionValue, 'support.action.session')
  if (session.staffActorId !== input.actorId || input.targetProtected || session.targetProtected || session.nested || Date.parse(session.expiresAt) <= input.now.getTime() || !input.targetCapabilities.has(input.capability) || input.capability.startsWith('internal.') || input.capability.startsWith('owner.')) throw new OperationsPolicyError('support-denied', 'Support cannot elevate, target protected authority, or outlive the bounded session.')
  return session
}

export type TransferExecutionStep = Readonly<{ asset: keyof typeof TRANSFER_STEP_OWNERS; ownerTicket: string; idempotencyKey: string; resumeRequired: true; compensationRequired: true }>

export function transferExecutionPlan(handoffValue: unknown, authority: TransferAuthoritySnapshot): Readonly<{ transferId: string; internalGrantExcluded: true; steps: readonly TransferExecutionStep[] }> {
  const handoff = authorizeTransferHandoff(handoffValue, authority)
  const steps = handoff.selectedAssets.map((asset) => Object.freeze({ asset, ownerTicket: TRANSFER_STEP_OWNERS[asset], idempotencyKey: `${handoff.transferId}:${asset}`, resumeRequired: true as const, compensationRequired: true as const }))
  return Object.freeze({ transferId: handoff.transferId, internalGrantExcluded: true as const, steps: Object.freeze(steps) })
}

export type PublicExpertProjection = Readonly<Omit<Pick<ExpertProfile, 'expertId' | 'kind' | 'name' | 'skills' | 'county' | 'availability' | 'approvedReleaseId' | 'publicRevision'>, 'skills'> & { skills: readonly string[] }>

export function publicExpertProjection(value: unknown): PublicExpertProjection {
  const expert = publicExpert(value)
  return Object.freeze({ expertId: expert.expertId, kind: expert.kind, name: expert.name, skills: Object.freeze([...expert.skills]), county: expert.county, availability: expert.availability, approvedReleaseId: expert.approvedReleaseId, publicRevision: expert.publicRevision })
}
