import { describe, expect, it } from 'bun:test'
import {
  CUSTOMER_ORGANIZATION_INVITATION_ROLES,
  OrganizationInvitationError,
  OrganizationInvitationService,
  type AcceptInvitationAuthorityInput,
  type AcceptedOrganizationMembership,
  type IssueInvitationAuthorityInput,
  type OrganizationInvitationRecord,
  type OrganizationInvitationRepository,
} from '../../../server/fuma/organizations/invitations'
import {
  FumaInvitationDeliveryJobs,
  ORGANIZATION_INVITATION_DELIVERY_JOB_KIND,
  type FumaInvitationDurableJobPort,
  type InvitationDurableJobInput,
  type InvitationDurableJobRecord,
} from '../../../server/fuma/organizations/invitationJobs'

const NOW = '2026-07-24T17:30:00.000Z'
const CUSTOMER_ORGANIZATION_ID = 'customer-org-1'

type UserAuthority = {
  email: string
  platformRole: 'admin' | 'support' | null
  hasStaffProfile: boolean
}

function invitationFailure(
  code: ConstructorParameters<typeof OrganizationInvitationError>[0],
  message: string,
  path: string,
): OrganizationInvitationError {
  return new OrganizationInvitationError(code, message, path)
}

class InMemoryInvitationAuthority implements OrganizationInvitationRepository {
  readonly authInvitations = new Map<string, OrganizationInvitationRecord>()
  readonly authMembers: AcceptedOrganizationMembership[] = []
  readonly authUsers = new Map<string, UserAuthority>()

  addUser(id: string, user: UserAuthority): void {
    this.authUsers.set(id, user)
  }

  addMembership(membership: AcceptedOrganizationMembership): void {
    this.authMembers.push(membership)
  }

  async issue(input: IssueInvitationAuthorityInput): Promise<Readonly<{
    invitation: OrganizationInvitationRecord
    created: boolean
  }>> {
    const actor = this.authMembers.find(({ organizationId, userId }) => (
      organizationId === input.organizationId && userId === input.actorUserId
    ))
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      throw invitationFailure('unauthorized-actor', 'Actor cannot manage invitations.', 'actorUserId')
    }
    const existing = this.authInvitations.get(input.id)
    if (existing) {
      if (
        existing.organizationId !== input.organizationId
        || existing.email !== input.normalizedEmail
        || existing.role !== input.role
        || existing.expiresAt !== input.expiresAt
        || existing.inviterId !== input.actorUserId
      ) {
        throw invitationFailure('idempotency-conflict', 'Idempotency input changed.', 'idempotencyKey')
      }
      return { invitation: existing, created: false }
    }
    const invitation: OrganizationInvitationRecord = {
      id: input.id,
      organizationId: input.organizationId,
      email: input.normalizedEmail,
      role: input.role,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: input.now.toISOString(),
      inviterId: input.actorUserId,
    }
    this.authInvitations.set(invitation.id, invitation)
    return { invitation, created: true }
  }

  async acceptAtomically(input: AcceptInvitationAuthorityInput): Promise<Readonly<{
    invitation: OrganizationInvitationRecord
    membership: AcceptedOrganizationMembership
    created: boolean
  }>> {
    const invitation = this.authInvitations.get(input.invitationId)
    if (!invitation) throw invitationFailure('invitation-not-found', 'Missing invitation.', 'invitationId')
    if (invitation.organizationId !== input.organizationId) {
      throw invitationFailure('cross-organization', 'Wrong organization.', 'organizationId')
    }
    if (invitation.email !== input.normalizedEmail) {
      throw invitationFailure('cross-email', 'Wrong invited email.', 'email')
    }
    const user = this.authUsers.get(input.userId)
    if (!user || user.email.trim().toLowerCase() !== input.normalizedEmail) {
      throw invitationFailure('cross-email', 'Identity does not own invited email.', 'userId')
    }
    const existing = this.authMembers.find(({ organizationId, userId }) => (
      organizationId === input.organizationId && userId === input.userId
    ))
    if (invitation.status === 'accepted') {
      if (!existing) throw invitationFailure('used', 'Invitation was used elsewhere.', 'invitationId')
      return { invitation, membership: existing, created: false }
    }
    if (invitation.status === 'used') {
      throw invitationFailure('used', 'Invitation was already used.', 'invitationId')
    }
    if (invitation.status === 'cancelled') {
      throw invitationFailure('cancelled', 'Invitation was cancelled.', 'invitationId')
    }
    if (Date.parse(invitation.expiresAt) <= input.now.getTime()) {
      throw invitationFailure('expired', 'Invitation expired.', 'expiresAt')
    }
    const membership = existing ?? {
      id: `membership-${invitation.id}`,
      organizationId: input.organizationId,
      userId: input.userId,
      role: invitation.role,
      createdAt: input.now.toISOString(),
    }
    if (!existing) this.authMembers.push(membership)
    const accepted: OrganizationInvitationRecord = { ...invitation, status: 'accepted' }
    this.authInvitations.set(invitation.id, accepted)
    return { invitation: accepted, membership, created: existing === undefined }
  }
}

class CapturingDurableJobs implements FumaInvitationDurableJobPort {
  readonly calls: InvitationDurableJobInput[] = []
  readonly byIdempotencyKey = new Map<string, InvitationDurableJobRecord>()

  async enqueue(input: InvitationDurableJobInput): Promise<Readonly<{
    job: InvitationDurableJobRecord
    created: boolean
  }>> {
    this.calls.push(input)
    const existing = this.byIdempotencyKey.get(input.idempotencyKey)
    if (existing) return { job: existing, created: false }
    const job: InvitationDurableJobRecord = {
      id: `delivery-job-${this.byIdempotencyKey.size + 1}`,
      organizationId: input.organizationId,
      siteId: null,
      kind: input.kind,
    }
    this.byIdempotencyKey.set(input.idempotencyKey, job)
    return { job, created: true }
  }
}

function harness() {
  let now = new Date(NOW)
  const repository = new InMemoryInvitationAuthority()
  repository.addUser('owner-1', {
    email: 'owner@customer.example',
    platformRole: null,
    hasStaffProfile: false,
  })
  repository.addUser('invitee-1', {
    email: 'person@customer.example',
    platformRole: null,
    hasStaffProfile: false,
  })
  repository.addUser('other-1', {
    email: 'other@customer.example',
    platformRole: null,
    hasStaffProfile: false,
  })
  repository.addMembership({
    id: 'customer-owner-membership',
    organizationId: CUSTOMER_ORGANIZATION_ID,
    userId: 'owner-1',
    role: 'owner',
    createdAt: NOW,
  })
  const durableJobs = new CapturingDurableJobs()
  const service = new OrganizationInvitationService({
    repository,
    deliveryJobs: new FumaInvitationDeliveryJobs(durableJobs),
    now: () => new Date(now),
  })
  return {
    repository,
    durableJobs,
    service,
    setNow(value: string) { now = new Date(value) },
  }
}

async function issueCustomerInvitation(
  service: OrganizationInvitationService,
  overrides: Record<string, unknown> = {},
) {
  return await service.issue({
    actorUserId: 'owner-1',
    organizationId: CUSTOMER_ORGANIZATION_ID,
    email: '  Person@Customer.Example ',
    role: 'member',
    expiresAt: '2026-07-25T17:30:00.000Z',
    idempotencyKey: 'customer-invitation-1',
    ...overrides,
  })
}

async function expectInvitationError(
  promise: Promise<unknown>,
  code: OrganizationInvitationError['code'],
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(OrganizationInvitationError)
    expect((error as OrganizationInvitationError).code).toBe(code)
    return
  }
  throw new Error(`Expected organization invitation error ${code}.`)
}

describe('FUMA-014 organization invitations', () => {
  it('issues idempotently, queues an organization-scoped delivery reference, and accepts once without platform access', async () => {
    const h = harness()
    const first = await issueCustomerInvitation(h.service)
    const repeatedIssue = await issueCustomerInvitation(h.service)

    expect(first.created).toBe(true)
    expect(repeatedIssue.created).toBe(false)
    expect(first.invitation.email).toBe('person@customer.example')
    expect(first.invitation.role).toBe('member')
    expect(first.delivery).toEqual({
      jobId: 'delivery-job-1',
      organizationId: CUSTOMER_ORGANIZATION_ID,
      created: true,
    })
    expect(repeatedIssue.delivery.created).toBe(false)

    const queued = h.durableJobs.calls[0]!
    expect(queued.organizationId).toBe(CUSTOMER_ORGANIZATION_ID)
    expect(queued.kind).toBe(ORGANIZATION_INVITATION_DELIVERY_JOB_KIND)
    expect(queued.payload).toEqual({ invitationId: first.invitation.id })
    expect(queued).not.toHaveProperty('siteId')
    const metadata = JSON.stringify(queued)
    expect(metadata).not.toContain('person@customer.example')
    expect(metadata).not.toMatch(/"(?:email|secret|token|body)"/i)

    const accepted = await h.service.accept({
      invitationId: first.invitation.id,
      organizationId: CUSTOMER_ORGANIZATION_ID,
      userId: 'invitee-1',
      email: 'PERSON@CUSTOMER.EXAMPLE',
    })
    const repeatedAcceptance = await h.service.accept({
      invitationId: first.invitation.id,
      organizationId: CUSTOMER_ORGANIZATION_ID,
      userId: 'invitee-1',
      email: 'person@customer.example',
    })

    expect(accepted.created).toBe(true)
    expect(repeatedAcceptance.created).toBe(false)
    expect(h.repository.authMembers.filter(({ userId }) => userId === 'invitee-1')).toHaveLength(1)
    expect(accepted.membership).toMatchObject({
      organizationId: CUSTOMER_ORGANIZATION_ID,
      userId: 'invitee-1',
      role: 'member',
    })
    const invitee = h.repository.authUsers.get('invitee-1')!
    expect(invitee.platformRole).toBeNull()
    expect(invitee.hasStaffProfile).toBe(false)
    expect(h.repository.authMembers.some(({ organizationId }) => organizationId === 'fuma-platform')).toBe(false)

    process.stdout.write('[FUMA-014 invitation demo] accepted=1 customerMemberships=1 platformAccess=false\n')
  })

  it('keeps customer invitation roles explicit and rejects platform/support/owner grants', async () => {
    expect(CUSTOMER_ORGANIZATION_INVITATION_ROLES).toEqual(['admin', 'member'])
    expect(CUSTOMER_ORGANIZATION_INVITATION_ROLES).not.toContain('owner')
    expect(CUSTOMER_ORGANIZATION_INVITATION_ROLES).not.toContain('support')
    expect(CUSTOMER_ORGANIZATION_INVITATION_ROLES).not.toContain('platform')

    const h = harness()
    for (const role of ['owner', 'support', 'platform']) {
      await expectInvitationError(
        issueCustomerInvitation(h.service, { role, idempotencyKey: `role-${role}` }),
        'invalid-input',
      )
    }
    await expectInvitationError(issueCustomerInvitation(h.service, {
      organizationId: 'fuma-platform',
      idempotencyKey: 'platform-attempt',
    }), 'platform-organization-forbidden')
  })

  it('requires an authorized organization owner/admin and a future expiry with a strict boundary', async () => {
    const h = harness()
    await expectInvitationError(
      issueCustomerInvitation(h.service, { actorUserId: 'other-1' }),
      'unauthorized-actor',
    )
    await expectInvitationError(issueCustomerInvitation(h.service, { expiresAt: NOW }), 'invalid-expiry')
    await expectInvitationError(issueCustomerInvitation(h.service, { unexpected: true }), 'invalid-input')
  })

  it('rejects cross-organization, cross-email, expired, used, and cancelled acceptance attempts', async () => {
    const h = harness()
    const { invitation } = await issueCustomerInvitation(h.service)
    const acceptance = {
      invitationId: invitation.id,
      organizationId: CUSTOMER_ORGANIZATION_ID,
      userId: 'invitee-1',
      email: 'person@customer.example',
    }

    await expectInvitationError(
      h.service.accept({ ...acceptance, organizationId: 'customer-org-2' }),
      'cross-organization',
    )
    await expectInvitationError(
      h.service.accept({ ...acceptance, email: 'other@customer.example' }),
      'cross-email',
    )
    await expectInvitationError(h.service.accept({ ...acceptance, userId: 'other-1' }), 'cross-email')

    h.setNow('2026-07-25T17:30:00.000Z')
    await expectInvitationError(h.service.accept(acceptance), 'expired')

    h.repository.authInvitations.set(invitation.id, { ...invitation, status: 'used' })
    await expectInvitationError(h.service.accept(acceptance), 'used')

    h.repository.authInvitations.set(invitation.id, { ...invitation, status: 'cancelled' })
    await expectInvitationError(h.service.accept(acceptance), 'cancelled')
    expect(h.repository.authMembers.filter(({ userId }) => userId === 'invitee-1')).toHaveLength(0)
  })
})
