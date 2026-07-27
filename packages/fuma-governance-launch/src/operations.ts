import {
  BreakGlassRequestSchema,
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
  constructor(readonly code: 'host-denied' | 'authority-denied' | 'contribution-denied' | 'support-denied' | 'break-glass-denied' | 'expert-hidden' | 'transfer-denied', message: string) {
    super(message)
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

  register(value: unknown): ConsoleContribution {
    const contribution = parseStrict(ConsoleContributionSchema, value, 'console.contribution')
    if (this.#contributions.has(contribution.contributionId)) throw new OperationsPolicyError('contribution-denied', 'Console contribution identity already exists.')
    for (const current of this.#contributions.values()) {
      if (current.routes.some((route) => contribution.routes.includes(route))) throw new OperationsPolicyError('contribution-denied', 'Console route ownership overlaps.')
    }
    this.#contributions.set(contribution.contributionId, contribution)
    return contribution
  }

  authorize(path: string, authority: InternalAuthority): ConsoleContribution {
    if (authority.host !== 'admin.fuma.co.ke') throw new OperationsPolicyError('host-denied', 'Platform console is admin-host only.')
    const contribution = [...this.#contributions.values()].find(({ routes }) => routes.includes(path))
    if (!contribution || contribution.requiredAuthorities.some((required) => !authority.authorities.has(required))) throw new OperationsPolicyError('authority-denied', 'Internal console authority denied.')
    return contribution
  }

  list(): readonly ConsoleContribution[] { return Object.freeze([...this.#contributions.values()].map((value) => structuredClone(value))) }
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
