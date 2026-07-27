import { createHash } from 'node:crypto'
import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID, OrganizationRoleSchema } from './contracts'
import type {
  InvitationDeliveryJobPort,
  InvitationDeliveryJobReceipt,
} from './invitationJobs'

const RequiredIdentifierSchema = Type.String({ minLength: 1, maxLength: 512, pattern: '\\S' })
const EmailInputSchema = Type.String({ minLength: 3, maxLength: 320 })
// Date semantics are checked explicitly because this repository does not register TypeBox string formats.
const IsoDateTimeStringSchema = Type.String({ minLength: 20, maxLength: 40 })

/** Customer membership roles that an invitation may grant. Platform roles are intentionally absent. */
export const CUSTOMER_ORGANIZATION_INVITATION_ROLES = Object.freeze(['admin', 'member'] as const)

export const CustomerOrganizationInvitationRoleSchema = Type.Union([
  Type.Literal('admin'),
  Type.Literal('member'),
])
export type CustomerOrganizationInvitationRole = Static<typeof CustomerOrganizationInvitationRoleSchema>

export const OrganizationInvitationStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('used'),
  Type.Literal('cancelled'),
])
export type OrganizationInvitationStatus = Static<typeof OrganizationInvitationStatusSchema>

export const IssueOrganizationInvitationInputSchema = Type.Object({
  actorUserId: RequiredIdentifierSchema,
  organizationId: RequiredIdentifierSchema,
  email: EmailInputSchema,
  role: CustomerOrganizationInvitationRoleSchema,
  expiresAt: IsoDateTimeStringSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512, pattern: '\\S' }),
}, { additionalProperties: false })
export type IssueOrganizationInvitationInput = Static<typeof IssueOrganizationInvitationInputSchema>

export const AcceptOrganizationInvitationInputSchema = Type.Object({
  invitationId: RequiredIdentifierSchema,
  organizationId: RequiredIdentifierSchema,
  userId: RequiredIdentifierSchema,
  email: EmailInputSchema,
}, { additionalProperties: false })
export type AcceptOrganizationInvitationInput = Static<typeof AcceptOrganizationInvitationInputSchema>

export const OrganizationInvitationRecordSchema = Type.Object({
  id: RequiredIdentifierSchema,
  organizationId: RequiredIdentifierSchema,
  email: Type.String({ minLength: 3, maxLength: 320 }),
  role: CustomerOrganizationInvitationRoleSchema,
  status: OrganizationInvitationStatusSchema,
  expiresAt: IsoDateTimeStringSchema,
  createdAt: IsoDateTimeStringSchema,
  inviterId: RequiredIdentifierSchema,
}, { additionalProperties: false })
export type OrganizationInvitationRecord = Static<typeof OrganizationInvitationRecordSchema>

export const AcceptedOrganizationMembershipSchema = Type.Object({
  id: RequiredIdentifierSchema,
  organizationId: RequiredIdentifierSchema,
  userId: RequiredIdentifierSchema,
  role: OrganizationRoleSchema,
  createdAt: IsoDateTimeStringSchema,
}, { additionalProperties: false })
export type AcceptedOrganizationMembership = Static<typeof AcceptedOrganizationMembershipSchema>

export type IssueOrganizationInvitationResult = Readonly<{
  invitation: OrganizationInvitationRecord
  created: boolean
  delivery: InvitationDeliveryJobReceipt
}>

export type AcceptOrganizationInvitationResult = Readonly<{
  invitation: OrganizationInvitationRecord
  membership: AcceptedOrganizationMembership
  created: boolean
}>

export type OrganizationInvitationErrorCode =
  | 'invalid-input'
  | 'invalid-email'
  | 'invalid-expiry'
  | 'unauthorized-actor'
  | 'platform-organization-forbidden'
  | 'idempotency-conflict'
  | 'invitation-not-found'
  | 'cross-organization'
  | 'cross-email'
  | 'expired'
  | 'used'
  | 'cancelled'
  | 'authority-conflict'

export class OrganizationInvitationError extends Error {
  readonly code: OrganizationInvitationErrorCode
  readonly path: string

  constructor(code: OrganizationInvitationErrorCode, message: string, path: string) {
    super(message)
    this.name = 'OrganizationInvitationError'
    this.code = code
    this.path = path
  }
}

export type IssueInvitationAuthorityInput = Readonly<{
  id: string
  actorUserId: string
  organizationId: string
  normalizedEmail: string
  role: CustomerOrganizationInvitationRole
  expiresAt: string
  idempotencyKey: string
  now: Date
}>

export type AcceptInvitationAuthorityInput = Readonly<{
  invitationId: string
  organizationId: string
  userId: string
  normalizedEmail: string
  now: Date
}>

/**
 * Authority port over the existing auth_invitations and auth_members models.
 * Implementations own transactionality; acceptance must lock, validate, insert
 * membership, and consume the invitation in one transaction.
 */
export interface OrganizationInvitationRepository {
  issue(input: IssueInvitationAuthorityInput): Promise<Readonly<{
    invitation: OrganizationInvitationRecord
    created: boolean
  }>>
  acceptAtomically(input: AcceptInvitationAuthorityInput): Promise<AcceptOrganizationInvitationResult>
}

export interface OrganizationInvitationServiceOptions {
  repository: OrganizationInvitationRepository
  deliveryJobs: InvitationDeliveryJobPort
  now?: () => Date
}

function invitationError(
  code: OrganizationInvitationErrorCode,
  message: string,
  path: string,
): OrganizationInvitationError {
  return new OrganizationInvitationError(code, message, path)
}

function parseBoundary<T extends TSchema>(schema: T, input: unknown, path: string): Static<T> {
  const parsed = safeParseValue(schema, input)
  if (!parsed.ok) {
    throw invitationError('invalid-input', `Organization invitation input is invalid at ${path}.`, path)
  }
  return parsed.value
}

export function normalizeInvitationEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (
    normalized.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    throw invitationError('invalid-email', 'Organization invitation email is invalid.', 'email')
  }
  return normalized
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw invitationError('invalid-input', 'Organization invitation clock returned an invalid date.', 'now')
  }
  return now
}

function deterministicId(namespace: string, ...parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update([namespace, ...parts].join('\u0000'))
    .digest('hex')
  return `${namespace}-${digest.slice(0, 40)}`
}

export function organizationInvitationId(organizationId: string, idempotencyKey: string): string {
  return deterministicId('org-inv', organizationId, idempotencyKey)
}

function organizationMembershipId(invitationId: string, userId: string): string {
  return deterministicId('org-member', invitationId, userId)
}

function assertCustomerOrganization(organizationId: string): void {
  if (organizationId === PLATFORM_ORGANIZATION_ID) {
    throw invitationError(
      'platform-organization-forbidden',
      'Customer invitation paths cannot grant platform organization access.',
      'organizationId',
    )
  }
}

export class OrganizationInvitationService {
  readonly #repository: OrganizationInvitationRepository
  readonly #deliveryJobs: InvitationDeliveryJobPort
  readonly #now: () => Date

  constructor(options: OrganizationInvitationServiceOptions) {
    this.#repository = options.repository
    this.#deliveryJobs = options.deliveryJobs
    this.#now = options.now ?? (() => new Date())
  }

  async issue(input: unknown): Promise<IssueOrganizationInvitationResult> {
    const parsed = parseBoundary(IssueOrganizationInvitationInputSchema, input, 'issue')
    assertCustomerOrganization(parsed.organizationId)
    const normalizedEmail = normalizeInvitationEmail(parsed.email)
    const idempotencyKey = parsed.idempotencyKey.trim()
    const now = validNow(this.#now())
    const expiresAt = new Date(parsed.expiresAt)
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw invitationError('invalid-expiry', 'Organization invitation expiry must be in the future.', 'expiresAt')
    }
    const authority = await this.#repository.issue({
      id: organizationInvitationId(parsed.organizationId, idempotencyKey),
      actorUserId: parsed.actorUserId,
      organizationId: parsed.organizationId,
      normalizedEmail,
      role: parsed.role,
      expiresAt: expiresAt.toISOString(),
      idempotencyKey,
      now,
    })
    const delivery = await this.#deliveryJobs.enqueue({
      organizationId: parsed.organizationId,
      invitationId: authority.invitation.id,
    })
    return { ...authority, delivery }
  }

  async accept(input: unknown): Promise<AcceptOrganizationInvitationResult> {
    const parsed = parseBoundary(AcceptOrganizationInvitationInputSchema, input, 'acceptance')
    assertCustomerOrganization(parsed.organizationId)
    return await this.#repository.acceptAtomically({
      invitationId: parsed.invitationId,
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      normalizedEmail: normalizeInvitationEmail(parsed.email),
      now: validNow(this.#now()),
    })
  }
}

interface InvitationRow {
  id: string
  organization_id: string
  email: string
  role: string | null
  status: string
  expires_at: string | Date
  created_at: string | Date
  inviter_id: string
}

interface MembershipRow {
  id: string
  organization_id: string
  user_id: string
  role: string
  created_at: string | Date
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function invitationStatus(status: string): OrganizationInvitationStatus {
  if (status === 'pending' || status === 'accepted' || status === 'used') return status
  if (status === 'cancelled' || status === 'canceled' || status === 'rejected' || status === 'revoked') {
    return 'cancelled'
  }
  throw invitationError('authority-conflict', `Stored invitation has unsupported status ${status}.`, 'status')
}

function parseStored<T extends TSchema>(schema: T, candidate: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) {
    throw invitationError('authority-conflict', `Stored ${label} failed schema validation.`, label)
  }
  return parsed.value
}

function mapInvitation(row: InvitationRow): OrganizationInvitationRecord {
  return parseStored(OrganizationInvitationRecordSchema, {
    id: row.id,
    organizationId: row.organization_id,
    email: normalizeInvitationEmail(row.email),
    role: row.role,
    status: invitationStatus(row.status),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    inviterId: row.inviter_id,
  }, `invitation ${row.id}`)
}

function mapMembership(row: MembershipRow): AcceptedOrganizationMembership {
  return parseStored(AcceptedOrganizationMembershipSchema, {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    createdAt: iso(row.created_at),
  }, `membership ${row.id}`)
}

function sameIssue(existing: OrganizationInvitationRecord, input: IssueInvitationAuthorityInput): boolean {
  return existing.organizationId === input.organizationId
    && existing.email === input.normalizedEmail
    && existing.role === input.role
    && existing.inviterId === input.actorUserId
    && existing.expiresAt === input.expiresAt
}

async function authorizedActor(
  tx: DbClient,
  organizationId: string,
  actorUserId: string,
): Promise<boolean> {
  const { rows } = await tx<{ role: string }>`
    select role from auth_members
    where organization_id = ${organizationId} and user_id = ${actorUserId}
  `
  return rows.length === 1 && (rows[0]?.role === 'owner' || rows[0]?.role === 'admin')
}

async function membershipFor(
  tx: DbClient,
  organizationId: string,
  userId: string,
): Promise<AcceptedOrganizationMembership | null> {
  const { rows } = await tx<MembershipRow>`
    select id, organization_id, user_id, role, created_at
    from auth_members
    where organization_id = ${organizationId} and user_id = ${userId}
  `
  if (rows.length > 1) {
    throw invitationError('authority-conflict', 'Duplicate authoritative organization memberships exist.', 'auth_members')
  }
  return rows[0] ? mapMembership(rows[0]) : null
}

export class PostgresOrganizationInvitationRepository implements OrganizationInvitationRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma organization invitations require PostgreSQL authority.')
    }
    this.#db = db
  }

  issue(input: IssueInvitationAuthorityInput): Promise<Readonly<{
    invitation: OrganizationInvitationRecord
    created: boolean
  }>> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'organization-invitation:' + input.id}, 0))`
      if (!await authorizedActor(tx, input.organizationId, input.actorUserId)) {
        throw invitationError(
          'unauthorized-actor',
          'An owner or administrator of this organization must issue invitations.',
          'actorUserId',
        )
      }
      const selected = await tx<InvitationRow>`
        select id, organization_id, email, role, status, expires_at, created_at, inviter_id
        from auth_invitations where id = ${input.id}
      `
      if (selected.rows.length > 1) {
        throw invitationError('authority-conflict', 'Duplicate authoritative invitations exist.', 'auth_invitations')
      }
      if (selected.rows[0]) {
        const existing = mapInvitation(selected.rows[0])
        if (!sameIssue(existing, input)) {
          throw invitationError(
            'idempotency-conflict',
            'Invitation idempotency key was already used with different input.',
            'idempotencyKey',
          )
        }
        return { invitation: existing, created: false }
      }
      const inserted = await tx<InvitationRow>`
        insert into auth_invitations (
          id, organization_id, email, role, status, expires_at, created_at, inviter_id
        ) values (
          ${input.id}, ${input.organizationId}, ${input.normalizedEmail}, ${input.role}, 'pending',
          ${input.expiresAt}, ${input.now.toISOString()}, ${input.actorUserId}
        ) returning id, organization_id, email, role, status, expires_at, created_at, inviter_id
      `
      if (!inserted.rows[0]) {
        throw invitationError('authority-conflict', 'Invitation insert returned no authoritative row.', 'auth_invitations')
      }
      return { invitation: mapInvitation(inserted.rows[0]), created: true }
    })
  }

  acceptAtomically(input: AcceptInvitationAuthorityInput): Promise<AcceptOrganizationInvitationResult> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<InvitationRow>`
        select id, organization_id, email, role, status, expires_at, created_at, inviter_id
        from auth_invitations where id = ${input.invitationId} for update
      `
      const row = selected.rows[0]
      if (!row) {
        throw invitationError('invitation-not-found', 'Organization invitation does not exist.', 'invitationId')
      }
      let invitation = mapInvitation(row)
      if (invitation.organizationId !== input.organizationId) {
        throw invitationError('cross-organization', 'Invitation belongs to a different organization.', 'organizationId')
      }
      if (invitation.email !== input.normalizedEmail) {
        throw invitationError('cross-email', 'Invitation belongs to a different email address.', 'email')
      }
      const identity = await tx<{ id: string }>`
        select id from auth_users
        where id = ${input.userId} and lower(btrim(email)) = ${input.normalizedEmail}
      `
      if (identity.rows.length !== 1) {
        throw invitationError('cross-email', 'Authenticated identity does not own the invited email address.', 'userId')
      }
      const existingMembership = await membershipFor(tx, input.organizationId, input.userId)
      if (invitation.status === 'accepted') {
        if (!existingMembership) {
          throw invitationError('used', 'Invitation was already used by another acceptance.', 'invitationId')
        }
        return { invitation, membership: existingMembership, created: false }
      }
      if (invitation.status === 'used') {
        throw invitationError('used', 'Invitation was already used.', 'invitationId')
      }
      if (invitation.status === 'cancelled') {
        throw invitationError('cancelled', 'Invitation was cancelled.', 'invitationId')
      }
      if (Date.parse(invitation.expiresAt) <= input.now.getTime()) {
        throw invitationError('expired', 'Invitation has expired.', 'expiresAt')
      }

      let membership = existingMembership
      let created = false
      if (!membership) {
        const inserted = await tx<MembershipRow>`
          insert into auth_members (id, organization_id, user_id, role, created_at)
          values (
            ${organizationMembershipId(invitation.id, input.userId)}, ${input.organizationId},
            ${input.userId}, ${invitation.role}, ${input.now.toISOString()}
          )
          on conflict (organization_id, user_id) do nothing
          returning id, organization_id, user_id, role, created_at
        `
        membership = inserted.rows[0]
          ? mapMembership(inserted.rows[0])
          : await membershipFor(tx, input.organizationId, input.userId)
        if (!membership) {
          throw invitationError('authority-conflict', 'Membership acceptance produced no authoritative row.', 'auth_members')
        }
        created = inserted.rowCount === 1
      }
      const consumed = await tx<InvitationRow>`
        update auth_invitations set status = 'accepted'
        where id = ${invitation.id} and status = 'pending'
        returning id, organization_id, email, role, status, expires_at, created_at, inviter_id
      `
      if (consumed.rowCount !== 1 || !consumed.rows[0]) {
        throw invitationError('used', 'Invitation was consumed by another acceptance.', 'invitationId')
      }
      invitation = mapInvitation(consumed.rows[0])
      return { invitation, membership, created }
    })
  }
}
